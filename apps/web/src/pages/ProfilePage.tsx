import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { updateOwnProfileSchema, changePasswordSchema, type TeamMember } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, apiUpload, ApiError } from "../lib/api";
import { apiErrorMessage, knownMessage } from "../i18n/errorMessages";
import { PageHeader } from "../components/PageHeader";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { useT } from "../i18n/LocaleContext";
import { CATEGORY_LABEL_KEY } from "../i18n/labels";

interface ProfileValues {
  name: string;
  initials: string;
  role: string;
  department: string;
  bio: string;
  photoUrl: string;
  googleScholarUrl: string;
  researchGateUrl: string;
  orcidUrl: string;
}

type FieldErrors = Partial<Record<keyof ProfileValues, string>>;

/** An uploaded photo is a same-site storage path. It is never shown to the user as if it were a photo URL. */
const isUploadedPhoto = (photoUrl: string) => photoUrl.startsWith("/api/files/");

function toValues(member: TeamMember): ProfileValues {
  return {
    name: member.name,
    initials: member.initials,
    role: member.role,
    department: member.department,
    bio: member.bio,
    // The field is the EXTERNAL photo URL: empty while an uploaded photo is in use.
    photoUrl: isUploadedPhoto(member.photoUrl) ? "" : member.photoUrl,
    googleScholarUrl: member.googleScholarUrl,
    researchGateUrl: member.researchGateUrl,
    orcidUrl: member.orcidUrl,
  };
}

export function ProfilePage() {
  const { user } = useAuth();
  const t = useT();
  const { data: member, loading, error, status, reload } = useApiResource<TeamMember>("/profile");

  return (
    <>
      <PageHeader eyebrow={t("profile.signedInAs", { email: user?.email ?? "" })} title={t("profile.pageTitle")} description={t("profile.pageDescription")} />
      <div className="container">
        {loading && !member && <LoadingState label={t("profile.loadingYours")} variant="text" />}
        {/* 404 just means no team profile is linked yet — a status, not a failure. */}
        {status === 404 && <EmptyState title={error ?? t("profile.noLinkedProfile")} />}
        {error && status !== 404 && <ErrorState message={error} onRetry={reload} />}
        {member && <ProfileForm initial={member} />}
        {/* Account security (password change) is an ACCOUNT action, not a team-profile one, so it
            is always available here even when this account has no linked team profile yet
            (status === 404 above) — see apps/server/src/routes/auth.routes.ts POST /auth/password. */}
        <GoogleLinkSection />
        <PasswordChangeSection />
      </div>
    </>
  );
}

const GOOGLE_RESULT_CODES = ["linked", "already_linked", "in_use", "has_other", "session", "failed", "unavailable"] as const;

/** Connect a Google account to the signed-in account. Rendered only when the server has Google configured. */
function GoogleLinkSection() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const result = GOOGLE_RESULT_CODES.find((c) => c === searchParams.get("google"));
  const [state, setState] = useState<{ enabled: boolean; linked: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ enabled: boolean; linked: boolean }>("/auth/google/link")
      .then((r) => !cancelled && setState(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (!state?.enabled) return null;

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      // Started by this signed-in session after re-verifying the account password; the server returns Google's
      // authorization URL for this exact account.
      const { url } = await apiFetch<{ url: string }>("/auth/google/link/start", { method: "POST", body: JSON.stringify({ currentPassword: password }) });
      setPassword("");
      window.location.assign(url);
    } catch (err) {
      setError(apiErrorMessage(err, t));
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/google/unlink", { method: "POST", body: JSON.stringify({ currentPassword: password }) });
      setPassword("");
      setDisconnected(true);
      setState({ enabled: true, linked: false });
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="detail-section" aria-labelledby="profile-google">
      <h2 id="profile-google">{t("profile.google.heading")}</h2>
      <p className="sub">{t("profile.google.description")}</p>
      {result && (
        <div className={result === "linked" || result === "already_linked" ? "form-success" : "form-error"} role="status">
          {t(`profile.google.result.${result}`)}
        </div>
      )}
      {disconnected && (
        <div className="form-success" role="status">
          {t("profile.google.disconnected")}
        </div>
      )}
      {error && <ErrorState message={error} />}
      <p>{state.linked ? t("profile.google.linked") : t("profile.google.notLinked")}</p>
      <div className="form-group">
        <label htmlFor="google_pw">{t("profile.google.password")}</label>
        <input id="google_pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {state.linked ? (
        <button className="btn" type="button" onClick={disconnect} disabled={busy || !password} aria-busy={busy}>
          {t("profile.google.disconnect")}
        </button>
      ) : (
        <button className="btn btn--primary" type="button" onClick={connect} disabled={busy || !password} aria-busy={busy}>
          {busy ? t("profile.google.connecting") : t("profile.google.connect")}
        </button>
      )}
    </section>
  );
}

function PasswordChangeSection() {
  const t = useT();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirm) {
      setError(t("profile.password.mismatch"));
      return;
    }
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }

    setSaving(true);
    try {
      await apiFetch("/auth/password", { method: "POST", body: JSON.stringify(parsed.data) });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? apiErrorMessage(err, t) : t("error.network"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="detail-section" aria-labelledby="profile-security">
      <h2 id="profile-security">{t("profile.password.heading")}</h2>
      <p className="sub">{t("profile.password.description")}</p>
      {success && (
        <div className="form-success" role="status">
          <Icon name="check" size={16} /> {t("profile.password.success")}
        </div>
      )}
      {error && <ErrorState message={error} />}
      <form className="form-card" onSubmit={handleSubmit} noValidate aria-label={t("profile.password.heading")}>
        <div className="form-group">
          <label htmlFor="pw_current">{t("profile.password.current")}</label>
          <input
            id="pw_current"
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="pw_new">{t("profile.password.new")}</label>
            <input id="pw_new" type="password" required autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="pw_confirm">{t("profile.password.confirm")}</label>
            <input id="pw_confirm" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={saving} aria-busy={saving}>
            {saving ? t("common.saving") : t("profile.password.submit")}
          </button>
        </div>
      </form>
    </section>
  );
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/** Mirrors the server's image cap for a fast, friendly check; the server remains the authority. */
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Own-profile photo upload. A separate form from the text profile (so the two never share a submit). The preview is a data: URL
 * (the CSP allows `data:` images but not `blob:`). The server removes known metadata containers (see the sanitizer limits in the architecture doc) and assigns
 * owner/visibility; the browser sends only the file.
 */
function PhotoUploader({
  initials,
  photoUrl,
  blockedReason,
  resetSignal,
  onBusyChange,
  onChanged,
}: {
  initials: string;
  photoUrl: string;
  /** Non-null while a conflicting unsaved edit makes uploading or removing unsafe (shown to the user, linked to the controls). */
  blockedReason: string | null;
  /** Changes whenever the surrounding form starts a new action (save, reset, URL edit): stale success messages are then cleared. */
  resetSignal: number;
  /** True while an upload or removal is in flight; the form disables the external-URL field meanwhile so a typed URL cannot be lost or race it. */
  onBusyChange: (busy: boolean) => void;
  onChanged: (photoUrl: string) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const readToken = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const blocked = blockedReason !== null;
  const [seenSignal, setSeenSignal] = useState(resetSignal);
  if (seenSignal !== resetSignal) {
    // Derived-state reset during render (not an effect): a success/removal notice describes the previous state of the form.
    setSeenSignal(resetSignal);
    setSuccess(false);
    setRemoved(false);
  }

  function failure(err: unknown, imageRejection = false): string {
    if (err instanceof ApiError) {
      if (err.status === 401) return t("profile.sessionExpired");
      const known = knownMessage(err.message, t);
      if (known !== err.message) return known;
      // an unlisted sanitizer detail on an UPLOAD: one localized, actionable message (not for a removal request)
      if (imageRejection && err.status === 400) return t("profile.photo.err.invalid");
    }
    return apiErrorMessage(err, t);
  }
  const setBusyAll = (value: boolean) => {
    setBusy(value);
    onBusyChange(value);
  };

  async function remove() {
    if (busyRef.current || blocked) return;
    busyRef.current = true;
    setBusyAll(true);
    setError(null);
    setSuccess(false);
    setRemoved(false);
    try {
      const updated = await apiFetch<TeamMember>("/profile", { method: "PUT", body: JSON.stringify({ photoUrl: "" }) });
      onChanged(updated.photoUrl);
      clearSelection();
      setRemoved(true);
    } catch (err) {
      setError(failure(err));
    } finally {
      busyRef.current = false;
      setBusyAll(false);
    }
  }

  function clearSelection() {
    readToken.current += 1;
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function choose(picked: File | undefined) {
    setSuccess(false);
    setRemoved(false);
    setError(null);
    clearSelection();
    if (!picked) return;
    if (!PHOTO_TYPES.includes(picked.type)) return setError(t("profile.photo.err.type"));
    if (picked.size > PHOTO_MAX_BYTES) return setError(t("profile.photo.err.size"));
    setFile(picked);
    const token = readToken.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (token === readToken.current && typeof reader.result === "string") setPreview(reader.result);
    };
    reader.readAsDataURL(picked);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || busyRef.current || blocked) return;
    busyRef.current = true;
    setBusyAll(true);
    setError(null);
    setSuccess(false);
    try {
      const body = new FormData();
      body.append("file", file);
      const updated = await apiUpload<TeamMember>("/profile/photo", body);
      onChanged(updated.photoUrl);
      clearSelection();
      setSuccess(true);
    } catch (err) {
      setError(failure(err, true)); // the previous photo, the selected file and the profile form's unsaved values are all left as they were
    } finally {
      busyRef.current = false;
      setBusyAll(false);
    }
  }

  return (
    <form className="photo-upload" onSubmit={submit} aria-labelledby="photo_heading" noValidate>
      <h2 className="photo-upload__heading" id="photo_heading">
        {t("profile.photo.heading")}
      </h2>
      <Avatar size="xl" initials={initials} photoUrl={preview ?? photoUrl} />
      {preview && <span className="sr-only">{t("profile.photo.previewAlt")}</span>}
      {/* The native file input is only a proxy: the visible, focusable control is the button below. A button with aria-disabled stays
          focusable, so the explanation it is described by (when blocked) is announced instead of the control silently vanishing. */}
      <input
        ref={inputRef}
        id="f_photoFile"
        className="sr-only"
        type="file"
        accept={PHOTO_TYPES.join(",")}
        onChange={(e) => choose(e.target.files?.[0])}
        disabled={busy || blocked}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        id="photo_choose"
        className={`btn btn--secondary btn--sm photo-upload__choose${busy || blocked ? " photo-upload__choose--disabled" : ""}`}
        aria-disabled={busy || blocked}
        aria-describedby={blocked ? "photo_help photo_blocked" : "photo_help"}
        onClick={() => {
          if (!busy && !blocked) inputRef.current?.click();
        }}
      >
        {t("profile.photo.choose")}
      </button>
      <p className="card-note" id="photo_help">
        {t("profile.photo.help")}
      </p>
      {blocked && (
        <p className="card-note photo-upload__blocked" id="photo_blocked">
          {blockedReason}
        </p>
      )}
      {file && <p className="card-note">{t("profile.photo.selected", { name: file.name })}</p>}
      {file && (
        <div className="form-actions">
          <button className="btn btn--primary btn--sm" type="submit" disabled={busy || blocked} aria-busy={busy} aria-describedby={blocked ? "photo_blocked" : undefined}>
            {busy ? t("profile.photo.uploading") : t("profile.photo.upload")}
          </button>
          <button className="btn btn--secondary btn--sm" type="button" onClick={clearSelection} disabled={busy}>
            {t("profile.photo.cancel")}
          </button>
        </div>
      )}
      {photoUrl && !file && (
        <button className="btn btn--secondary btn--sm" type="button" onClick={remove} disabled={busy || blocked} aria-busy={busy} aria-describedby={blocked ? "photo_blocked" : undefined}>
          {busy ? t("profile.photo.removing") : t("profile.photo.remove")}
        </button>
      )}
      {error && (
        <p className="form-field-error" role="alert">
          {error}
        </p>
      )}
      {removed && !blocked && (
        <p className="form-success" role="status">
          <Icon name="check" size={16} /> {t("profile.photo.removed")}
        </p>
      )}
      {success && !blocked && (
        <p className="form-success" role="status">
          <Icon name="check" size={16} /> {t("profile.photo.success")}
        </p>
      )}
    </form>
  );
}

function ProfileForm({ initial }: { initial: TeamMember }) {
  const t = useT();
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState<ProfileValues>(() => toValues(initial));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  // The photo can change while a text save is in flight (an upload or removal finishes first). A save response is a snapshot
  // from BEFORE that change, so it must not put the older photo URL back: photoVersion counts photo changes made here, and
  // latestPhoto is the newest URL they produced.
  const photoVersion = useRef(0);
  const latestPhoto = useRef(initial.photoUrl);
  const [photoSignal, setPhotoSignal] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);

  const savedValues = toValues(saved);
  const dirty = (Object.keys(values) as (keyof ProfileValues)[]).some((k) => values[k] !== savedValues[k]);

  function change(key: keyof ProfileValues, value: string) {
    if (key === "photoUrl") setPhotoSignal((n) => n + 1);
    setValues((v) => ({ ...v, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    setSuccess(false);
  }

  function reset() {
    setPhotoSignal((n) => n + 1);
    setValues(savedValues);
    setFieldErrors({});
    setFormError(null);
    setSuccess(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccess(false);
    setPhotoSignal((n) => n + 1);

    // photoUrl is validated and sent only if this form changed it: an uploaded photo is a same-site /api/files/ path, which the
    // external-URL rule rightly rejects, and an unchanged value must never be written back over a newer upload.
    const photoChanged = values.photoUrl !== savedValues.photoUrl;
    // The research links follow the same rule: each is sent only if this form changed it.
    const linkIfChanged = (k: "googleScholarUrl" | "researchGateUrl" | "orcidUrl") => (values[k] !== savedValues[k] ? values[k] : undefined);
    const parsed = updateOwnProfileSchema.safeParse({
      ...values,
      photoUrl: photoChanged ? values.photoUrl : undefined,
      googleScholarUrl: linkIfChanged("googleScholarUrl"),
      researchGateUrl: linkIfChanged("researchGateUrl"),
      orcidUrl: linkIfChanged("orcidUrl"),
    });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ProfileValues | undefined;
        if (key === undefined) setFormError(knownMessage(issue.message, t));
        else if (!errors[key]) errors[key] = knownMessage(issue.message, t);
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    const versionAtStart = photoVersion.current;
    try {
      const response = await apiFetch<TeamMember>("/profile", { method: "PUT", body: JSON.stringify(parsed.data) });
      // Show exactly what the server stored (it trims), without a second fetch, except that a photo change made while this
      // request was in flight wins over the older photo URL in the response.
      const updated = photoVersion.current === versionAtStart ? response : { ...response, photoUrl: latestPhoto.current };
      setSaved(updated);
      setValues(toValues(updated));
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.status === 401 ? t("profile.sessionExpired") : knownMessage(err.message, t));
      } else {
        setFormError(t("error.network"));
      }
    } finally {
      setSaving(false);
    }
  }

  function field(key: keyof ProfileValues) {
    const message = fieldErrors[key];
    return {
      id: `f_${key}`,
      value: values[key],
      onChange: (e: { target: { value: string } }) => change(key, e.target.value),
      "aria-invalid": message ? (true as const) : undefined,
      "aria-describedby": message ? `f_${key}_error` : undefined,
    };
  }

  /** aria-describedby for a field that has a hint line (and, when invalid, its error line). */
  function describe(key: keyof ProfileValues) {
    return [fieldErrors[key] ? `f_${key}_error` : null, `f_${key}_hint`].filter(Boolean).join(" ");
  }

  function fieldError(key: keyof ProfileValues) {
    const message = fieldErrors[key];
    return message ? (
      <p className="form-field-error" id={`f_${key}_error`}>
        {message}
      </p>
    ) : null;
  }

  return (
    <div className="detail-layout detail-layout--aside-first">
      <div>
        {success && (
          <div className="form-success" role="status">
            <Icon name="check" size={16} /> {t("profile.updated")}
          </div>
        )}
        {formError && <ErrorState message={formError} />}

        <form className="form-card" onSubmit={handleSubmit} noValidate aria-label={t("profile.editAria")}>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="f_name">{t("profile.fullName")}</label>
              <input {...field("name")} maxLength={120} required autoComplete="name" />
              {fieldError("name")}
            </div>
            <div className="form-group">
              <label htmlFor="f_initials">{t("profile.initialsLabel")}</label>
              <input {...field("initials")} maxLength={10} required />
              {fieldError("initials")}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="f_role">{t("profile.roleTitle")}</label>
              <input {...field("role")} maxLength={120} required autoComplete="organization-title" />
              {fieldError("role")}
            </div>
            <div className="form-group">
              <label htmlFor="f_department">{t("profile.department")}</label>
              <input {...field("department")} maxLength={200} />
              {fieldError("department")}
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="f_bio">{t("profile.shortBio")}</label>
            <textarea {...field("bio")} maxLength={2000} />
            {fieldError("bio")}
          </div>
          <div className="form-group">
            <label htmlFor="f_photoUrl">{t("profile.photoUrl")}</label>
            <input
              {...field("photoUrl")}
              disabled={photoBusy}
              placeholder="https://..."
              inputMode="url"
              aria-describedby={[fieldErrors.photoUrl ? "f_photoUrl_error" : null, isUploadedPhoto(saved.photoUrl) ? "f_photoUrl_hint" : null].filter(Boolean).join(" ") || undefined}
            />
            {isUploadedPhoto(saved.photoUrl) && (
              <p className="card-note" id="f_photoUrl_hint">
                {t("profile.photo.uploadedInUse")}
              </p>
            )}
            {fieldError("photoUrl")}
          </div>

          <fieldset className="form-fieldset">
            <legend>{t("research.linksLegend")}</legend>
            <div className="form-group">
              <label htmlFor="f_googleScholarUrl">{t("research.googleScholar")}</label>
              <input {...field("googleScholarUrl")} placeholder="https://scholar.google.com/citations?user=…" inputMode="url" maxLength={300} aria-describedby={describe("googleScholarUrl")} />
              <p className="form-hint" id="f_googleScholarUrl_hint">{t("research.googleScholarHint")}</p>
              {fieldError("googleScholarUrl")}
            </div>
            <div className="form-group">
              <label htmlFor="f_researchGateUrl">{t("research.researchGate")}</label>
              <input {...field("researchGateUrl")} placeholder="https://www.researchgate.net/profile/…" inputMode="url" maxLength={300} aria-describedby={describe("researchGateUrl")} />
              <p className="form-hint" id="f_researchGateUrl_hint">{t("research.researchGateHint")}</p>
              {fieldError("researchGateUrl")}
            </div>
            <div className="form-group">
              <label htmlFor="f_orcidUrl">{t("research.orcid")}</label>
              <input {...field("orcidUrl")} placeholder="0000-0000-0000-0000" maxLength={300} aria-describedby={describe("orcidUrl")} />
              <p className="form-hint" id="f_orcidUrl_hint">{t("research.orcidHint")}</p>
              {fieldError("orcidUrl")}
            </div>
          </fieldset>

          <div className="form-actions">
            <button className="btn btn--primary form-submit" type="submit" disabled={saving || !dirty} aria-busy={saving}>
              {saving ? t("common.saving") : t("profile.saveChanges")}
            </button>
            <button className="btn btn--secondary" type="button" onClick={reset} disabled={saving || !dirty}>
              {t("profile.reset")}
            </button>
          </div>
        </form>
      </div>

      <aside className="detail-layout__aside" aria-label={t("member.researcherSummaryAria")}>
        <section className="panel profile-summary">
          <PhotoUploader
            initials={values.initials || saved.initials}
            photoUrl={saved.photoUrl}
            blockedReason={values.photoUrl !== savedValues.photoUrl ? t("profile.photo.blockedByUrl") : null}
            resetSignal={photoSignal}
            onBusyChange={setPhotoBusy}
            onChanged={(photoUrl) => {
              photoVersion.current += 1;
              latestPhoto.current = photoUrl;
              // The uploader is blocked while a URL edit is pending and the URL field is disabled while an upload/removal runs,
              // so no draft can exist here and nothing the user typed is lost.
              setSaved((s) => ({ ...s, photoUrl }));
              setValues((v) => ({ ...v, photoUrl: isUploadedPhoto(photoUrl) ? "" : photoUrl }));
            }}
          />
          <div>
            <p className="profile-summary__role">{values.name || saved.name}</p>
            <p className="profile-summary__dept">{values.role}</p>
          </div>
          <p className="card-note">{t("profile.categoryNote", { category: t(CATEGORY_LABEL_KEY[saved.category]) })}</p>
          <Link to={`/team/${saved.id}`} className="btn btn--secondary btn--sm">
            {t("profile.viewPublic")} <Icon name="arrow-right" size={14} />
          </Link>
        </section>
      </aside>
    </div>
  );
}

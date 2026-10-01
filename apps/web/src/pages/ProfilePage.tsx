import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { updateOwnProfileSchema, changePasswordSchema, type TeamMember } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { apiErrorMessage } from "../i18n/errorMessages";
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
}

type FieldErrors = Partial<Record<keyof ProfileValues, string>>;

function toValues(member: TeamMember): ProfileValues {
  return {
    name: member.name,
    initials: member.initials,
    role: member.role,
    department: member.department,
    bio: member.bio,
    photoUrl: member.photoUrl,
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
        <PasswordChangeSection />
      </div>
    </>
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

function ProfileForm({ initial }: { initial: TeamMember }) {
  const t = useT();
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState<ProfileValues>(() => toValues(initial));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const savedValues = toValues(saved);
  const dirty = (Object.keys(values) as (keyof ProfileValues)[]).some((k) => values[k] !== savedValues[k]);

  function change(key: keyof ProfileValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    setSuccess(false);
  }

  function reset() {
    setValues(savedValues);
    setFieldErrors({});
    setFormError(null);
    setSuccess(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccess(false);

    const parsed = updateOwnProfileSchema.safeParse(values);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ProfileValues | undefined;
        if (key === undefined) setFormError(issue.message);
        else if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const updated = await apiFetch<TeamMember>("/profile", { method: "PUT", body: JSON.stringify(parsed.data) });
      // Show exactly what the server stored (it trims), without a second fetch.
      setSaved(updated);
      setValues(toValues(updated));
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.status === 401 ? t("profile.sessionExpired") : err.message);
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
            <input {...field("photoUrl")} placeholder="https://..." inputMode="url" />
            {fieldError("photoUrl")}
          </div>

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
          <Avatar size="xl" initials={values.initials || saved.initials} photoUrl={saved.photoUrl} />
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

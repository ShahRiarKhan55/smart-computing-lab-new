import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createTeamMemberSchema, type Category, type TeamMember } from "@scl/shared";
import { Modal } from "./Modal";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage, knownMessage } from "../i18n/errorMessages";
import { useEntityTranslations } from "../hooks/useEntityTranslations";
import { CATEGORY_LABEL_KEY } from "../i18n/labels";
import { DuplicateConfirm } from "./DuplicateConfirm";
import { useDuplicateConfirm } from "../hooks/useDuplicateConfirm";

export interface TeamMemberFormValues {
  name: string;
  initials: string;
  role: string;
  department: string;
  bio: string;
  /** Omitted when unchanged on an edit (see handleSubmit). */
  photoUrl?: string;
  /** Phase 3C research links; like photoUrl they are omitted on an edit when unchanged. "" clears a link. */
  googleScholarUrl?: string;
  researchGateUrl?: string;
  orcidUrl?: string;
  category: Category;
  sortOrder: number;
  translations?: { ja: Record<string, string> };
  /** Set only after a duplicate-name warning was explicitly confirmed (lab manager / admin). */
  confirmDuplicate?: boolean;
}

interface TeamMemberFormModalProps {
  open: boolean;
  title: string;
  initial?: Partial<TeamMember> | null;
  /** Category and sort order are admin-only fields, mirroring the reference's permission rules. */
  showAdminFields: boolean;
  /** Offer the Alumni category (administrators only; the API re-checks). */
  allowAlumni?: boolean;
  onClose: () => void;
  onSubmit: (values: TeamMemberFormValues) => Promise<void>;
}

const LINK_KEYS = ["googleScholarUrl", "researchGateUrl", "orcidUrl"] as const;

const CATEGORY_ORDER: Category[] = ["FACULTY", "PHD", "MSC", "BSC", "RESEARCH"];
const CATEGORY_ORDER_WITH_ALUMNI: Category[] = [...CATEGORY_ORDER, "ALUMNI"];

/** An uploaded photo is a same-site storage path; it is never shown in the URL field as if it were a photo URL. */
const isUploadedPhoto = (photoUrl: string | undefined) => (photoUrl ?? "").startsWith("/api/files/");

function toFormValues(initial?: Partial<TeamMember> | null): Omit<TeamMemberFormValues, "translations" | "photoUrl" | "googleScholarUrl" | "researchGateUrl" | "orcidUrl"> & {
  photoUrl: string;
  googleScholarUrl: string;
  researchGateUrl: string;
  orcidUrl: string;
} {
  return {
    name: initial?.name ?? "",
    initials: initial?.initials ?? "",
    role: initial?.role ?? "",
    department: initial?.department ?? "",
    bio: initial?.bio ?? "",
    photoUrl: isUploadedPhoto(initial?.photoUrl) ? "" : initial?.photoUrl ?? "",
    googleScholarUrl: initial?.googleScholarUrl ?? "",
    researchGateUrl: initial?.researchGateUrl ?? "",
    orcidUrl: initial?.orcidUrl ?? "",
    category: initial?.category ?? "BSC",
    sortOrder: initial?.sortOrder ?? 0,
  };
}

export function TeamMemberFormModal({
  open,
  title,
  initial,
  showAdminFields,
  allowAlumni = false,
  onClose,
  onSubmit,
}: TeamMemberFormModalProps) {
  const t = useT();
  const [values, setValues] = useState(() => toFormValues(initial));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removePhoto, setRemovePhoto] = useState(false);
  const dup = useDuplicateConfirm();
  const { values: ja, setField: setJa, base } = useEntityTranslations("TEAM_MEMBER", initial?.id, open);

  useEffect(() => {
    if (open) {
      setValues(toFormValues(initial));
      setError(null);
      dup.reset();
      setRemovePhoto(false); // the modal stays mounted between opens: a pending removal must never carry over to another open or member
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // A page fetched in Japanese already carries the Japanese override in these fields; saving that back would
  // overwrite the English text. Once the entity's own English text arrives, it replaces the prefill.
  useEffect(() => {
    if (!open || !base) return;
    setValues((v) => ({ ...v, ...(base.bio != null ? { bio: base.bio } : {}) }));
  }, [open, base]);

  function set<K extends keyof ReturnType<typeof toFormValues>>(key: K, value: ReturnType<typeof toFormValues>[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    dup.reset(); // a changed field invalidates any earlier duplicate warning and its confirmation
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // An uploaded profile photo is a same-site /api/files/ path, which the external-URL rule rightly rejects. On an edit the
    // value is validated and sent only if this form changed it, so it is never written back over a newer upload.
    const photoChanged = !initial?.id || values.photoUrl !== toFormValues(initial).photoUrl;
    const { photoUrl: _photo, ...rest } = values;
    // The research links follow the same rule: on an edit each is sent only if this form changed it.
    const original = toFormValues(initial);
    const sentLinks = (v: typeof rest) =>
      Object.fromEntries(LINK_KEYS.filter((k) => !initial?.id || v[k] !== original[k]).map((k) => [k, v[k]]));
    const { googleScholarUrl: _gs, researchGateUrl: _rg, orcidUrl: _oc, ...restNoLinks } = rest;
    const payload = { ...restNoLinks, ...sentLinks(rest), ...(removePhoto ? { photoUrl: "" } : photoChanged ? { photoUrl: values.photoUrl } : {}), ...dup.extra };
    const validation = createTeamMemberSchema.safeParse(payload);
    if (!validation.success) {
      setError(knownMessage(validation.error.issues[0]?.message ?? "", t) || t("common.checkForm"));
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ ...payload, ...(initial?.id ? { translations: { ja } } : {}) });
      onClose();
    } catch (err) {
      dup.capture(err);
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <DuplicateConfirm conflict={dup.conflict} confirmed={dup.confirmed} onConfirmedChange={dup.setConfirmed} />
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="tm_name">{t("team.fullNameLabel")}</label>
            <input id="tm_name" value={values.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="tm_initials">{t("team.initialsFieldLabel")}</label>
            <input
              id="tm_initials"
              value={values.initials}
              onChange={(e) => set("initials", e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="tm_role">{t("team.roleFieldLabel")}</label>
            <input
              id="tm_role"
              value={values.role}
              onChange={(e) => set("role", e.target.value)}
              placeholder={t("team.roleFieldPlaceholder")}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="tm_department">{t("team.departmentFieldLabel")}</label>
            <input id="tm_department" value={values.department} onChange={(e) => set("department", e.target.value)} />
          </div>
        </div>

        {showAdminFields && (
          <div className="form-group">
            <label htmlFor="tm_category">{t("team.categoryFieldLabel")}</label>
            <select
              id="tm_category"
              value={values.category}
              onChange={(e) => set("category", e.target.value as Category)}
            >
              {(allowAlumni ? CATEGORY_ORDER_WITH_ALUMNI : CATEGORY_ORDER).map((cat) => (
                <option key={cat} value={cat}>
                  {t(CATEGORY_LABEL_KEY[cat])}
                </option>
              ))}
            </select>
            {values.category === "ALUMNI" && <p className="form-hint">{t("alumni.formNote")}</p>}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="tm_bio">{t("team.bioFieldLabel")}</label>
          <textarea id="tm_bio" value={values.bio} onChange={(e) => set("bio", e.target.value)} />
        </div>

        <div className="form-group">
          <label htmlFor="tm_photoUrl">{t("team.photoUrlLabel")}</label>
          <input
            id="tm_photoUrl"
            value={values.photoUrl}
            onChange={(e) => {
              set("photoUrl", e.target.value);
              if (e.target.value) setRemovePhoto(false); // typing a replacement supersedes a pending removal
            }}
            placeholder="https://..."
            aria-describedby={isUploadedPhoto(initial?.photoUrl) ? "tm_photoUrl_hint" : undefined}
          />
          {isUploadedPhoto(initial?.photoUrl) && (
            <p className="card-note" id="tm_photoUrl_hint">
              {removePhoto ? t("team.photoWillBeRemoved") : t("team.photoUploadedInUse")}
            </p>
          )}
          {initial?.id && initial.photoUrl && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setRemovePhoto((v) => !v)} aria-pressed={removePhoto}>
              {removePhoto ? t("team.photoKeep") : t("profile.photo.remove")}
            </button>
          )}
        </div>

        <fieldset className="form-fieldset">
          <legend>{t("research.linksLegend")}</legend>
          <div className="form-group">
            <label htmlFor="tm_googleScholarUrl">{t("research.googleScholar")}</label>
            <input id="tm_googleScholarUrl" value={values.googleScholarUrl} onChange={(e) => set("googleScholarUrl", e.target.value)} placeholder="https://scholar.google.com/citations?user=…" inputMode="url" maxLength={300} aria-describedby="tm_googleScholarUrl_hint" />
            <p className="form-hint" id="tm_googleScholarUrl_hint">{t("research.googleScholarHint")}</p>
          </div>
          <div className="form-group">
            <label htmlFor="tm_researchGateUrl">{t("research.researchGate")}</label>
            <input id="tm_researchGateUrl" value={values.researchGateUrl} onChange={(e) => set("researchGateUrl", e.target.value)} placeholder="https://www.researchgate.net/profile/…" inputMode="url" maxLength={300} aria-describedby="tm_researchGateUrl_hint" />
            <p className="form-hint" id="tm_researchGateUrl_hint">{t("research.researchGateHint")}</p>
          </div>
          <div className="form-group">
            <label htmlFor="tm_orcidUrl">{t("research.orcid")}</label>
            <input id="tm_orcidUrl" value={values.orcidUrl} onChange={(e) => set("orcidUrl", e.target.value)} placeholder="0000-0000-0000-0000" maxLength={300} aria-describedby="tm_orcidUrl_hint" />
            <p className="form-hint" id="tm_orcidUrl_hint">{t("research.orcidHint")}</p>
          </div>
        </fieldset>

        {showAdminFields && (
          <div className="form-group">
            <label htmlFor="tm_sortOrder">{t("team.sortOrderLabel")}</label>
            <input
              id="tm_sortOrder"
              type="number"
              value={values.sortOrder}
              onChange={(e) => set("sortOrder", Number(e.target.value) || 0)}
            />
          </div>
        )}

        {!showAdminFields && <p className="modal__lead">{t("team.categoryAdminOnlyNote")}</p>}

        {initial?.id && (
          <fieldset className="form-fieldset">
            <legend>{t("lang.ja.name")}</legend>
            <div className="form-group">
              <label htmlFor="tm_bio_ja">
                {t("common.optional")}: {t("team.bioJaLabel")}
              </label>
              <textarea id="tm_bio_ja" value={ja.bio ?? ""} onChange={(e) => setJa("bio", e.target.value)} />
            </div>
          </fieldset>
        )}

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

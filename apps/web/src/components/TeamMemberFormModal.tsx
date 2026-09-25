import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createTeamMemberSchema, type Category, type TeamMember } from "@scl/shared";
import { Modal } from "./Modal";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";
import { useEntityTranslations } from "../hooks/useEntityTranslations";
import { CATEGORY_LABEL_KEY } from "../i18n/labels";

export interface TeamMemberFormValues {
  name: string;
  initials: string;
  role: string;
  department: string;
  bio: string;
  photoUrl: string;
  category: Category;
  sortOrder: number;
  translations?: { ja: Record<string, string> };
}

interface TeamMemberFormModalProps {
  open: boolean;
  title: string;
  initial?: Partial<TeamMember> | null;
  /** Category and sort order are admin-only fields, mirroring the reference's permission rules. */
  showAdminFields: boolean;
  onClose: () => void;
  onSubmit: (values: TeamMemberFormValues) => Promise<void>;
}

const CATEGORY_ORDER: Category[] = ["FACULTY", "PHD", "MSC", "BSC", "RESEARCH"];

function toFormValues(initial?: Partial<TeamMember> | null): Omit<TeamMemberFormValues, "translations"> {
  return {
    name: initial?.name ?? "",
    initials: initial?.initials ?? "",
    role: initial?.role ?? "",
    department: initial?.department ?? "",
    bio: initial?.bio ?? "",
    photoUrl: initial?.photoUrl ?? "",
    category: initial?.category ?? "BSC",
    sortOrder: initial?.sortOrder ?? 0,
  };
}

export function TeamMemberFormModal({
  open,
  title,
  initial,
  showAdminFields,
  onClose,
  onSubmit,
}: TeamMemberFormModalProps) {
  const t = useT();
  const [values, setValues] = useState(() => toFormValues(initial));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { values: ja, setField: setJa, base } = useEntityTranslations("TEAM_MEMBER", initial?.id, open);

  useEffect(() => {
    if (open) {
      setValues(toFormValues(initial));
      setError(null);
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
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validation = createTeamMemberSchema.safeParse(values);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ ...values, ...(initial?.id ? { translations: { ja } } : {}) });
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {error && <div className="form-error" role="alert">{error}</div>}
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
              {CATEGORY_ORDER.map((cat) => (
                <option key={cat} value={cat}>
                  {t(CATEGORY_LABEL_KEY[cat])}
                </option>
              ))}
            </select>
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
            onChange={(e) => set("photoUrl", e.target.value)}
            placeholder="https://..."
          />
        </div>

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

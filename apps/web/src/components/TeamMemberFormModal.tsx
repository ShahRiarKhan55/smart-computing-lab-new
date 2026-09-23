import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createTeamMemberSchema, type Category, type TeamMember } from "@scl/shared";
import { Modal } from "./Modal";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";

export interface TeamMemberFormValues {
  name: string;
  initials: string;
  role: string;
  department: string;
  bio: string;
  photoUrl: string;
  category: Category;
  sortOrder: number;
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

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "FACULTY", label: "Faculty" },
  { value: "PHD", label: "PhD Students" },
  { value: "MSC", label: "MSc Students" },
  { value: "BSC", label: "BSc Students" },
  { value: "RESEARCH", label: "Research Students" },
];

function toFormValues(initial?: Partial<TeamMember> | null): TeamMemberFormValues {
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
  const [values, setValues] = useState<TeamMemberFormValues>(() => toFormValues(initial));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(toFormValues(initial));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  function set<K extends keyof TeamMemberFormValues>(key: K, value: TeamMemberFormValues[K]) {
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
      await onSubmit(values);
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
            <label htmlFor="tm_name">Full name</label>
            <input id="tm_name" value={values.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="tm_initials">Initials (shown on avatar)</label>
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
            <label htmlFor="tm_role">Role / title</label>
            <input
              id="tm_role"
              value={values.role}
              onChange={(e) => set("role", e.target.value)}
              placeholder="e.g. PhD Candidate"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="tm_department">Department / focus area</label>
            <input id="tm_department" value={values.department} onChange={(e) => set("department", e.target.value)} />
          </div>
        </div>

        {showAdminFields && (
          <div className="form-group">
            <label htmlFor="tm_category">Category</label>
            <select
              id="tm_category"
              value={values.category}
              onChange={(e) => set("category", e.target.value as Category)}
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="tm_bio">Short bio (optional)</label>
          <textarea id="tm_bio" value={values.bio} onChange={(e) => set("bio", e.target.value)} />
        </div>

        <div className="form-group">
          <label htmlFor="tm_photoUrl">Photo URL (optional — leave blank to show initials)</label>
          <input
            id="tm_photoUrl"
            value={values.photoUrl}
            onChange={(e) => set("photoUrl", e.target.value)}
            placeholder="https://..."
          />
        </div>

        {showAdminFields && (
          <div className="form-group">
            <label htmlFor="tm_sortOrder">Sort order (lower shows first)</label>
            <input
              id="tm_sortOrder"
              type="number"
              value={values.sortOrder}
              onChange={(e) => set("sortOrder", Number(e.target.value) || 0)}
            />
          </div>
        )}

        {!showAdminFields && (
          <p className="modal__lead">
            Your category (Faculty / PhD / MSc / BSc / Research) can only be changed by the admin.
          </p>
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

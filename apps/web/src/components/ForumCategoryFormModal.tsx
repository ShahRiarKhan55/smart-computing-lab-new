import { useEffect, useState, type FormEvent } from "react";
import { createForumCategorySchema, type ForumCategory, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { ApiError } from "../lib/api";
import { useT } from "../i18n/LocaleContext";

export interface ForumCategoryFormFields {
  name: string;
  description: string;
  visibility: Visibility;
  isLocked: boolean;
}

interface ForumCategoryFormModalProps {
  open: boolean;
  title: string;
  initial?: ForumCategory | null;
  onClose: () => void;
  onSubmit: (fields: ForumCategoryFormFields) => Promise<void>;
}

function toFormState(initial?: ForumCategory | null) {
  return { name: initial?.name ?? "", description: initial?.description ?? "" };
}

/** Lab manager/admin only (Category CRUD — §7/§16 of the Phase 11 spec). */
export function ForumCategoryFormModal({ open, title, initial, onClose, onSubmit }: ForumCategoryFormModalProps) {
  const t = useT();
  const [values, setValues] = useState(() => toFormState(initial));
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? "LAB_ONLY");
  const [isLocked, setIsLocked] = useState(initial?.isLocked ?? false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial));
      setVisibility(initial?.visibility ?? "LAB_ONLY");
      setIsLocked(initial?.isLocked ?? false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validation = createForumCategorySchema.safeParse({ ...values, visibility, isLocked });
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ name: values.name, description: values.description, visibility, isLocked });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="cat_name">{t("forum.categoryName")}</label>
          <input id="cat_name" value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} maxLength={120} required data-autofocus />
        </div>
        <div className="form-group">
          <label htmlFor="cat_description">{t("forum.categoryDescription")}</label>
          <textarea id="cat_description" value={values.description} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} maxLength={2000} rows={3} />
        </div>
        <VisibilityField id="cat_visibility" value={visibility} onChange={setVisibility} />
        <label className="check-row">
          <input type="checkbox" checked={isLocked} onChange={(e) => setIsLocked(e.target.checked)} />
          <span>{t("forum.lockedCheckboxLabel")}</span>
        </label>
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

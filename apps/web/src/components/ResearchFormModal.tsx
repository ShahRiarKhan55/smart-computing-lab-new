import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createResearchAreaSchema, type CreateResearchAreaInput, type ResearchArea, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";
import { useEntityTranslations } from "../hooks/useEntityTranslations";

/** What the form hands to the page: the validated, trimmed research fields. */
export type ResearchFormFields = CreateResearchAreaInput;

interface ResearchFormModalProps {
  open: boolean;
  title: string;
  /** Existing area when editing; omit/null to create a new one. */
  initial?: ResearchArea | null;
  /** Lab managers/admins only; the API rejects anyone else who sends it. */
  canSetVisibility?: boolean;
  onClose: () => void;
  onSubmit: (fields: ResearchFormFields) => Promise<void>;
}

interface FormState {
  icon: string;
  tag: string;
  title: string;
  description: string;
  /** Kept as text so an empty box is "not entered" (→ 0, like the reference) rather than 0 typed by the user. */
  sortOrder: string;
}

function toFormState(initial?: ResearchArea | null): FormState {
  return {
    icon: initial?.icon ?? "🔬",
    tag: initial?.tag ?? "",
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    sortOrder: String(initial?.sortOrder ?? 0),
  };
}

export function ResearchFormModal({ open, title, initial, canSetVisibility = false, onClose, onSubmit }: ResearchFormModalProps) {
  const t = useT();
  const [values, setValues] = useState<FormState>(() => toFormState(initial));
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? "PUBLIC");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { values: ja, setField: setJa } = useEntityTranslations("RESEARCH_AREA", initial?.id, open);

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial));
      setVisibility(initial?.visibility ?? "PUBLIC");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const sortOrderText = values.sortOrder.trim();
    const validation = createResearchAreaSchema.safeParse({
      ...values,
      sortOrder: sortOrderText === "" ? 0 : Number(sortOrderText),
    });
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }

    const fields = canSetVisibility ? { ...validation.data, visibility } : validation.data;
    // Only an existing area has somewhere for a translation override to attach (see
    // useEntityTranslations.ts); a new one is created English-only, and the Japanese section
    // becomes available the next time it's edited.
    const payload = initial ? { ...fields, translations: { ja } } : fields;

    setSubmitting(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="research_icon">{t("research.iconLabel")}</label>
            <input id="research_icon" value={values.icon} onChange={(e) => set("icon", e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="research_tag">{t("research.tagLabel")}</label>
            <input
              id="research_tag"
              value={values.tag}
              onChange={(e) => set("tag", e.target.value)}
              placeholder={t("research.tagPlaceholder")}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="research_title">{t("research.titleFieldLabel")}</label>
          <input id="research_title" value={values.title} onChange={(e) => set("title", e.target.value)} required />
        </div>

        <div className="form-group">
          <label htmlFor="research_description">{t("research.descriptionFieldLabel")}</label>
          <textarea
            id="research_description"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="research_sortOrder">{t("research.sortOrderLabel")}</label>
          <input
            id="research_sortOrder"
            type="number"
            value={values.sortOrder}
            onChange={(e) => set("sortOrder", e.target.value)}
          />
        </div>

        {canSetVisibility && <VisibilityField id="research_visibility" value={visibility} onChange={setVisibility} />}

        {/* Phase 14: the minimum practical translation-editing UI (§33) — an English field next to
            a Japanese one, inside the same form, rather than a separate translation workflow. Only
            shown once the area exists (see useEntityTranslations.ts). Clearing a box removes that
            override, falling back to the English text above. */}
        {initial && (
          <fieldset className="form-fieldset">
            <legend>{t("lang.ja.name")}</legend>
            <div className="form-group">
              <label htmlFor="research_title_ja">
                {t("common.optional")}: {t("research.titleJaLabel")}
              </label>
              <input id="research_title_ja" value={ja.title ?? ""} onChange={(e) => setJa("title", e.target.value)} maxLength={200} />
            </div>
            <div className="form-group">
              <label htmlFor="research_description_ja">
                {t("common.optional")}: {t("research.descriptionJaLabel")}
              </label>
              <textarea id="research_description_ja" value={ja.description ?? ""} onChange={(e) => setJa("description", e.target.value)} maxLength={2000} />
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

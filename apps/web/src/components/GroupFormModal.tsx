import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createGroupSchema, type GroupSummary, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";
import { useEntityTranslations } from "../hooks/useEntityTranslations";

export type GroupFormPayload = Record<string, unknown>;

interface GroupFormModalProps {
  open: boolean;
  title: string;
  /** Existing group when editing; omit/null to create a new one. */
  initial?: GroupSummary | null;
  /** Lab managers/admins: visibility, sort order, slug. A group lead edits name + description only. */
  canManageSettings: boolean;
  onClose: () => void;
  onSubmit: (payload: GroupFormPayload) => Promise<void>;
}

interface FormState {
  name: string;
  description: string;
  visibility: Visibility;
  sortOrder: string;
  slug: string;
}

function toFormState(initial?: GroupSummary | null): FormState {
  return {
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    visibility: initial?.visibility ?? "LAB_ONLY", // a new group starts internal
    sortOrder: String(initial?.sortOrder ?? 0),
    slug: "",
  };
}

export function GroupFormModal({ open, title, initial, canManageSettings, onClose, onSubmit }: GroupFormModalProps) {
  const t = useT();
  const [values, setValues] = useState<FormState>(() => toFormState(initial));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { values: ja, setField: setJa, base } = useEntityTranslations("RESEARCH_GROUP", initial?.id, open);

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // A page fetched in Japanese already carries the Japanese override in these fields; saving that back would
  // overwrite the English text. Once the entity's own English text arrives, it replaces the prefill.
  useEffect(() => {
    if (!open || !base) return;
    setValues((v) => ({ ...v, ...(base.name != null ? { name: base.name } : {}), ...(base.description != null ? { description: base.description } : {}) }));
  }, [open, base]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const sortOrderText = values.sortOrder.trim();
    const validation = createGroupSchema.safeParse({
      name: values.name,
      description: values.description,
      ...(canManageSettings && {
        visibility: values.visibility,
        sortOrder: sortOrderText === "" ? 0 : Number(sortOrderText),
        slug: values.slug.trim() || undefined,
      }),
    });
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }
    const d = validation.data;
    const payload: GroupFormPayload = {
      name: d.name,
      description: d.description,
      ...(canManageSettings && { visibility: d.visibility, sortOrder: d.sortOrder, ...(d.slug ? { slug: d.slug } : {}) }),
      ...(initial ? { translations: { ja } } : {}),
    };

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
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="group_name">{t("groups.nameFieldLabel")}</label>
          <input id="group_name" value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={120} required />
        </div>

        <div className="form-group">
          <label htmlFor="group_description">{t("groups.descriptionFieldLabel")}</label>
          <textarea id="group_description" value={values.description} onChange={(e) => set("description", e.target.value)} />
        </div>

        {canManageSettings && (
          <>
            <VisibilityField id="group_visibility" value={values.visibility} onChange={(v) => set("visibility", v)} />
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="group_sortOrder">{t("groups.sortOrderLabel")}</label>
                <input id="group_sortOrder" type="number" value={values.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="group_slug">{t("groups.slugLabel")}</label>
                <input
                  id="group_slug"
                  value={values.slug}
                  onChange={(e) => set("slug", e.target.value)}
                  placeholder={initial ? t("groups.slugPlaceholderKeep") : t("groups.slugPlaceholderGenerated")}
                />
              </div>
            </div>
          </>
        )}

        {initial && (
          <fieldset className="form-fieldset">
            <legend>{t("lang.ja.name")}</legend>
            <div className="form-group">
              <label htmlFor="group_name_ja">
                {t("common.optional")}: {t("groups.nameJaLabel")}
              </label>
              <input id="group_name_ja" value={ja.name ?? ""} onChange={(e) => setJa("name", e.target.value)} maxLength={120} />
            </div>
            <div className="form-group">
              <label htmlFor="group_description_ja">
                {t("common.optional")}: {t("groups.descriptionJaLabel")}
              </label>
              <textarea id="group_description_ja" value={ja.description ?? ""} onChange={(e) => setJa("description", e.target.value)} />
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

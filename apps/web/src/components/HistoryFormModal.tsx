import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createHistoryEntrySchema, type HistoryEntry } from "@scl/shared";
import { Modal } from "./Modal";
import { ApiError } from "../lib/api";
import { useT } from "../i18n/LocaleContext";

export interface HistoryFormValues {
  year: string;
  title: string;
  description: string;
  sortOrder: number;
}

interface HistoryFormModalProps {
  open: boolean;
  initial?: HistoryEntry | null;
  onClose: () => void;
  onSubmit: (values: HistoryFormValues) => Promise<void>;
}

function toFormValues(initial?: HistoryEntry | null): HistoryFormValues {
  return {
    year: initial?.year ?? "",
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    sortOrder: initial?.sortOrder ?? 0,
  };
}

export function HistoryFormModal({ open, initial, onClose, onSubmit }: HistoryFormModalProps) {
  const t = useT();
  const [values, setValues] = useState<HistoryFormValues>(() => toFormValues(initial));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(toFormValues(initial));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  function set<K extends keyof HistoryFormValues>(key: K, value: HistoryFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validation = createHistoryEntrySchema.safeParse(values);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? t("common.editHistoryTitle") : t("common.addHistoryTitle")}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="h_year">{t("common.yearLabel")}</label>
            <input
              id="h_year"
              value={values.year}
              onChange={(e) => set("year", e.target.value)}
              placeholder={t("common.yearPlaceholder")}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="h_sortOrder">{t("common.sortOrderLabel")}</label>
            <input
              id="h_sortOrder"
              type="number"
              value={values.sortOrder}
              onChange={(e) => set("sortOrder", Number(e.target.value) || 0)}
            />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="h_title">{t("common.titleLabel")}</label>
          <input
            id="h_title"
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={t("common.historyTitlePlaceholder")}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="h_description">{t("common.descriptionOptionalLabel")}</label>
          <textarea id="h_description" value={values.description} onChange={(e) => set("description", e.target.value)} />
        </div>

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

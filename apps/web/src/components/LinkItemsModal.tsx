import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Modal } from "./Modal";
import { ApiError } from "../lib/api";
import { useT } from "../i18n/LocaleContext";

export interface LinkableItem {
  id: string;
  label: string;
}

interface LinkItemsModalProps {
  open: boolean;
  title: string;
  description: string;
  items: LinkableItem[];
  selectedIds: string[];
  /** Items shown but not toggleable (e.g. other people's links a member may not change). */
  disabledIds?: string[];
  onClose: () => void;
  onSubmit: (ids: string[]) => Promise<void>;
}

/** Generic checkbox-list linking modal, used for both publications and news. */
export function LinkItemsModal({
  open,
  title,
  description,
  items,
  selectedIds,
  disabledIds = [],
  onClose,
  onSubmit,
}: LinkItemsModalProps) {
  const t = useT();
  const [checked, setChecked] = useState<Set<string>>(new Set(selectedIds));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setChecked(new Set(selectedIds));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit([...checked]);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="modal__lead">{description}</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit}>
        {items.length === 0 ? (
          <p className="modal__lead">{t("common.nothingToLink")}</p>
        ) : (
          <div className="pick-list">
            {items.map((item) => (
              <label key={item.id} className="pick-item">
                <span className="pick-item__label">
                  <input
                    type="checkbox"
                    checked={checked.has(item.id)}
                    disabled={disabledIds.includes(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span>{item.label}</span>
                </span>
              </label>
            ))}
          </div>
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

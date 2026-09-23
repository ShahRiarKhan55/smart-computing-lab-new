import { useState } from "react";
import { Modal } from "./Modal";
import { ErrorState } from "./ErrorState";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";

interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/** In-page replacement for window.confirm on destructive actions. Focus starts on Cancel, the safe choice. */
export function ConfirmDeleteModal({ open, title, message, onClose, onConfirm }: ConfirmDeleteModalProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function close() {
    setError(null);
    onClose();
  }

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm();
      close();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : close} title={title}>
      <p className="modal__body">{message}</p>
      {error && <ErrorState message={error} />}
      <div className="modal__actions">
        <button className="btn btn--secondary" type="button" onClick={close} disabled={submitting} data-autofocus>
          {t("common.cancel")}
        </button>
        <button className="btn btn--danger" type="button" onClick={handleConfirm} disabled={submitting}>
          {submitting ? t("common.deleting") : t("common.delete")}
        </button>
      </div>
    </Modal>
  );
}

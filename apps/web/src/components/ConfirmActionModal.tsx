import { useState } from "react";
import { Modal } from "./Modal";
import { ErrorState } from "./ErrorState";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";

interface ConfirmActionModalProps {
  open: boolean;
  title: string;
  message: string;
  /** The button that performs the action ("Unlink", "Change visibility"). */
  confirmLabel: string;
  busyLabel: string;
  /** A destructive action gets the red button; a reversible one the ordinary primary button. */
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * The generic sibling of ConfirmDeleteModal for admin actions that are not deletions: same dialog
 * chrome (focus trap, Escape, focus returns to the opener), focus starts on Cancel — the safe choice —
 * and a failed request is shown inside the dialog instead of being lost.
 */
export function ConfirmActionModal({ open, title, message, confirmLabel, busyLabel, danger, onClose, onConfirm }: ConfirmActionModalProps) {
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
        <button className={`btn ${danger ? "btn--danger" : "btn--primary"}`} type="button" onClick={handleConfirm} disabled={submitting}>
          {submitting ? busyLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

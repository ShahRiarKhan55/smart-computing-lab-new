import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog chrome for every modal in the app: `role="dialog"` named by its title, focus moves in
 * (to `[data-autofocus]`, else the first field, else the dialog) and is trapped, Escape closes, the page
 * behind does not scroll, and focus returns to whatever opened it.
 */
export function Modal({ open, onClose, title, children }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const pressedOnOverlay = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;

    const first =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]), textarea, select');
    (first ?? dialog).focus();

    const scrollY = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || active === dialog)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = scrollY;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      // Close on a click that both starts and ends on the backdrop, so dragging a text selection out of a field does not dismiss it.
      onMouseDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnOverlay.current && e.target === e.currentTarget) onClose();
        pressedOnOverlay.current = false;
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
        <div className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button className="modal__close" onClick={onClose} type="button" aria-label="Close dialog">
            <Icon name="close" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

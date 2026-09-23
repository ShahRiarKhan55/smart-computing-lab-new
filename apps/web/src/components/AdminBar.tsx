import type { ReactNode } from "react";

interface AdminBarProps {
  text: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** For bars that need more than one button (e.g. the member profile toolbar). */
  actions?: ReactNode;
}

/** The toolbar shown to people who can edit, above editable content. Buttons keep plain-language labels. */
export function AdminBar({ text, actionLabel, onAction, actions }: AdminBarProps) {
  return (
    <div className="admin-bar">
      <span className="admin-bar__text">{text}</span>
      {actions ? (
        <div className="admin-bar__actions">{actions}</div>
      ) : (
        actionLabel &&
        onAction && (
          <button className="btn btn--primary btn--sm" onClick={onAction} type="button">
            {actionLabel}
          </button>
        )
      )}
    </div>
  );
}

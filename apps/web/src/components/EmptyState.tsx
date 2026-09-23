import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** A quiet one-line variant for a section inside a page (no dashed frame). */
  compact?: boolean;
  className?: string;
}

/** "Nothing here yet", with the context to act on it. Never decoration. */
export function EmptyState({ title, children, action, compact, className = "" }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}${className ? ` ${className}` : ""}`}>
      <p className="empty-state__title">{title}</p>
      {children && <div className="empty-state__text">{children}</div>}
      {action}
    </div>
  );
}

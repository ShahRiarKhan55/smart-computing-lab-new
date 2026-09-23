import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  /** A "View all →" link or button on the right. */
  action?: ReactNode;
  /** h2 by default; use 3 inside a section that already has an h2. */
  level?: 2 | 3;
  id?: string;
  /** Smaller title, for sections inside a detail page. */
  compact?: boolean;
}

export function SectionHeader({ title, eyebrow, description, action, level = 2, id, compact }: SectionHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={`section-header${level === 3 || compact ? " section-header--sub" : ""}`}>
      <div className="section-header__text">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <Heading className="section-header__title" id={id}>
          {title}
        </Heading>
        {description && <p className="section-header__desc">{description}</p>}
      </div>
      {action}
    </div>
  );
}

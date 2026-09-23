import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

interface AvatarProps {
  initials: string;
  photoUrl?: string;
  size?: "sm" | "md" | "lg" | "xl";
  /** Link to the profile; the accessible name is then the person's name. */
  to?: string;
  name?: string;
  className?: string;
}

/**
 * A person's photo, or their initials when there is none. The picture is decorative wherever the
 * name is printed next to it (the usual case), so it has an empty alt; alone (a link) it is named.
 */
export function Avatar({ initials, photoUrl, size = "md", to, name, className = "" }: AvatarProps) {
  const cls = `avatar${size !== "md" ? ` avatar--${size}` : ""}${className ? ` ${className}` : ""}`;
  // Long initials shrink to stay inside the circle.
  const scale = initials.length <= 2 ? 0.38 : initials.length === 3 ? 0.31 : 0.25;
  const style = { "--avatar-scale": scale } as CSSProperties;
  const inner = photoUrl ? <img src={photoUrl} alt="" loading="lazy" decoding="async" /> : initials;
  if (to) {
    return (
      <Link to={to} className={cls} style={style} aria-label={name} title={name}>
        {inner}
      </Link>
    );
  }
  return (
    <span className={cls} style={style} aria-hidden="true">
      {inner}
    </span>
  );
}

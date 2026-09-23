interface LoadingStateProps {
  /** Announced to screen readers ("Loading projects…"). */
  label?: string;
  /** Skeleton shape: card grid, list rows, or lines of text. */
  variant?: "cards" | "list" | "text";
  count?: number;
}

/**
 * A lightweight skeleton in the same footprint as the content that follows, so nothing jumps when
 * the data arrives. The shimmer stops under prefers-reduced-motion.
 */
export function LoadingState({ label = "Loading…", variant = "cards", count }: LoadingStateProps) {
  const n = count ?? (variant === "list" ? 4 : 3);
  const shape = variant === "cards" ? "card" : variant === "list" ? "row" : "text";
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={variant === "cards" ? "grid" : "skeleton-stack"}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={`skeleton-block skeleton-block--${shape}`} />
        ))}
      </div>
    </div>
  );
}

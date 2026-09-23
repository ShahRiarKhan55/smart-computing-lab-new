import { Icon } from "./Icon";

interface ErrorStateProps {
  message: string;
  /** Offered when trying again can help (a failed load). */
  onRetry?: () => void;
  retryClassName?: string;
}

/** A user-facing failure: what went wrong in plain words, and a way to retry. Never a stack trace. */
export function ErrorState({ message, onRetry, retryClassName = "" }: ErrorStateProps) {
  return (
    <div className="form-error error-state" role="alert">
      <span className="error-state__msg">
        <Icon name="alert" size={16} /> {message}
      </span>
      {onRetry && (
        <button type="button" className={`btn btn--sm btn--secondary${retryClassName ? ` ${retryClassName}` : ""}`} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

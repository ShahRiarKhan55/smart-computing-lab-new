import { useCallback, useState } from "react";
import type { DuplicateConflictBody } from "@scl/shared";
import { duplicateConflictOf } from "../lib/duplicateConflict";

/**
 * State of a form's answer to a duplicate warning. After the API refuses a save with a duplicate conflict, `capture(err)` records it
 * (and returns true so the form can skip its generic error); `confirmed` is the "this is a different record" checkbox, and `extra` is
 * what to merge into the next request body. The checkbox is only offered when the server says this requester may override
 * (`conflict.canOverride`); the API re-checks, so this is presentation only.
 */
export function useDuplicateConfirm() {
  const [conflict, setConflict] = useState<Omit<DuplicateConflictBody, "error"> | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  /** True when `err` was a duplicate conflict (now shown by <DuplicateConfirm>). */
  const capture = useCallback((err: unknown): boolean => {
    const c = duplicateConflictOf(err);
    setConflict(c);
    setConfirmed(false);
    return c !== null;
  }, []);

  const reset = useCallback(() => {
    setConflict(null);
    setConfirmed(false);
  }, []);

  const extra: { confirmDuplicate?: true } = conflict?.canOverride && confirmed ? { confirmDuplicate: true } : {};
  return { conflict, confirmed, setConfirmed, capture, reset, extra };
}

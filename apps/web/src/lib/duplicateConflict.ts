import { DUPLICATE_CODE, type DuplicateCandidate, type DuplicateConflictBody } from "@scl/shared";
import { ApiError } from "./api";

/**
 * The machine-readable duplicate conflict (HTTP 409, `code: "DUPLICATE_CANDIDATE"`) carried by an {@link ApiError}, or null for any other
 * error. The body is validated defensively: only the documented fields are read and anything malformed is treated as "not a duplicate
 * conflict", so the form falls back to showing the ordinary error message.
 */
export function duplicateConflictOf(err: unknown): Omit<DuplicateConflictBody, "error"> | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const b = err.body as Partial<DuplicateConflictBody> | null | undefined;
  if (!b || b.code !== DUPLICATE_CODE || typeof b.kind !== "string") return null;
  const candidates: DuplicateCandidate[] = Array.isArray(b.candidates)
    ? b.candidates.filter((c): c is DuplicateCandidate => Boolean(c) && typeof c.id === "string" && typeof c.label === "string")
    : [];
  return { code: DUPLICATE_CODE, kind: b.kind, overridable: b.overridable === true, canOverride: b.canOverride === true, candidates };
}

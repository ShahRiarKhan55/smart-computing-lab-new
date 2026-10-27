import type { ErrorRequestHandler } from "express";
import { LibsqlError } from "@libsql/client";
import { Prisma } from "@prisma/client";

/**
 * Classification of database constraint failures that works on BOTH database topologies this app runs on.
 *
 * Local SQLite: Prisma maps a violation to a typed error (`P2002` unique, `P2003` foreign key).
 * Turso/libSQL over the network (observed in the Phase 2.2.3 rehearsal with Prisma 5.22 + @prisma/adapter-libsql 5.22):
 * the adapter only produces typed errors when the driver error carries a numeric `rawCode`, which remote errors do not.
 * Prisma then surfaces a `PrismaClientKnownRequestError` whose `code` is the driver's string code `SQLITE_CONSTRAINT`
 * (no `P2002`/`P2003`, no `meta.target`), and whose message ends with the driver's own text on its LAST line
 * (e.g. `UNIQUE constraint failed: User.email`); everything above that line is Prisma's code frame and is ignored here.
 * A last line that is itself a numbered code-frame line (an empty driver message) is not driver text and classifies nothing.
 * The phrase match is deliberately not anchored to the start of the line: the exact wording a real Turso error wraps around
 * the SQLite text is NOT verified, and inventing a prefix format would risk missing real errors.
 * The same `SQLITE_CONSTRAINT` code is used for unique, foreign-key, NOT NULL and CHECK failures, so the code alone is
 * never treated as "duplicate".
 *
 * `constraintKind` returns a kind only when there is evidence for it, otherwise `"constraint"` (a constraint failure of
 * unknown type) or `null` (not a constraint failure). Callers must treat `"constraint"` conservatively.
 */
export type ConstraintKind = "unique" | "foreign_key" | "constraint";

/**
 * Prisma prefixes its message with a code frame whose every line starts with a line number (optionally after the `→`
 * marker), e.g. `21 await prisma.user.create(` / `→ 22 try {`. The driver's own text follows it as the last line. If the
 * driver supplied no text, the last line would be a code-frame line - which can contain arbitrary source text such as a
 * comment mentioning a constraint - so such a line is never treated as driver text.
 */
const CODE_FRAME_LINE = /^(?:→\s*)?\d+\s/;

function driverMessageLine(err: { message?: unknown }): string {
  const lines = String(err.message ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : "";
  return CODE_FRAME_LINE.test(last) ? "" : last;
}

export function constraintKind(err: unknown): ConstraintKind | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const code = String(err.code);
  if (code === "P2002") return "unique";
  if (code === "P2003") return "foreign_key";
  if (!code.startsWith("SQLITE_CONSTRAINT")) return null;
  // Extended result codes, when the driver supplies them.
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") return "unique";
  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") return "foreign_key";
  // Plain `SQLITE_CONSTRAINT` (the observed remote shape): only the driver's own final message line can tell.
  const driverText = driverMessageLine(err);
  if (/\bUNIQUE constraint failed\b/i.test(driverText)) return "unique";
  if (/\bFOREIGN KEY constraint failed\b/i.test(driverText)) return "foreign_key";
  return "constraint";
}

/**
 * Transient lock contention: the database reported SQLITE_BUSY ("database is locked"): a write or commit could not get its lock. For
 * the embedded database that is definitive (a BUSY statement applied nothing, and a BUSY commit is rolled back by lib/libsqlGuard.ts).
 * The server does NOT retry it for the caller; it answers 503 with `Retry-After` so the client can decide.
 *
 * Deliberately NOT included: Prisma's generic timeout class (`P1008`, "Timed out during query execution", "Operations timed out").
 * Against a remote database a timed-out COMMIT can have been applied, so those stay a generic 500 until remote behaviour is verified.
 * Recognised by the driver's `SQLITE_BUSY` code or the driver's own final message line (never the code frame above it).
 */
export const SERVICE_BUSY_MESSAGE = "The service is busy. Please try again in a moment.";
const BUSY_DRIVER_TEXT = /database is locked|SQLITE_BUSY/i;
export function isTransientDatabaseContention(err: unknown): boolean {
  if (err instanceof LockWaitTimeoutError) return true;
  // The embedded libSQL client's own error (e.g. a COMMIT that stayed BUSY after lib/libsqlGuard.ts rolled the transaction back).
  if (err instanceof LibsqlError) return String(err.code).startsWith("SQLITE_BUSY");
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const code = String(err.code);
    if (code.startsWith("SQLITE_BUSY")) return true;
    return BUSY_DRIVER_TEXT.test(driverMessageLine(err));
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) return BUSY_DRIVER_TEXT.test(driverMessageLine(err));
  return false;
}

/**
 * The FIRST statement of a lock-first transaction (a write that takes the write lock before anything else is read or written) did not run
 * before Prisma's interactive-transaction timeout. Measured against a remote Turso database (runbook scenario 11): while another connection
 * holds the write lock, the statement waits instead of failing with SQLITE_BUSY; Prisma then expires the transaction and rejects it with
 * `P2028` ("A query cannot be executed on an expired transaction"), which has no lock-specific text and also describes unrelated expiries.
 * Position is what makes it safe to classify: because this was the transaction's first statement, the callback threw before issuing any
 * other statement, so no COMMIT is ever sent and nothing of this request can have been persisted; retrying is safe. A `P2028` from any
 * LATER statement or from the COMMIT is never converted (a remote COMMIT that timed out may have been applied) and stays a generic 500.
 */
export class LockWaitTimeoutError extends Error {
  constructor() {
    super("The first statement of the transaction could not run before the transaction timeout (write lock not acquired).");
    this.name = "LockWaitTimeoutError";
  }
}

/** Wrap ONLY the first statement of a lock-first transaction: a `P2028` from it becomes {@link LockWaitTimeoutError}; anything else passes through. */
export async function asLockWait<T>(firstStatement: PromiseLike<T>): Promise<T> {
  try {
    return await firstStatement;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") throw new LockWaitTimeoutError();
    throw err;
  }
}

/**
 * Router-level error handler for the profile-photo routes (profile, team, files): contention answers 503 + `Retry-After`; every other
 * error continues to the application's error handler unchanged. It is deliberately NOT global: existing tests and clients of the
 * forum, messages and gallery routes rely on the long-standing 500 for a database error that is not a recognised constraint failure.
 */
export const transientContentionAs503: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent || !isTransientDatabaseContention(err)) return next(err);
  // One short line: the error text can carry a code frame and is not needed for a condition that is expected under load.
  console.error("[db] transient lock contention; answering 503");
  res.set("Retry-After", "1").status(503).json({ error: SERVICE_BUSY_MESSAGE });
};

export interface MappedDatabaseError {
  status: number;
  error: string;
}

/**
 * The HTTP response for a database error that the API treats as a client error, or `null` (the caller then answers a
 * generic 500). The response bodies are the app's long-standing contract and are already in the localized known-error
 * table. A constraint failure of unknown type, and every non-constraint error, is deliberately NOT mapped.
 */
export function mapKnownDatabaseError(err: unknown): MappedDatabaseError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return { status: 404, error: "Not found" };
  switch (constraintKind(err)) {
    case "foreign_key":
      return { status: 400, error: "A referenced record does not exist." };
    case "unique":
      return { status: 409, error: "That record already exists." };
    default:
      return null;
  }
}

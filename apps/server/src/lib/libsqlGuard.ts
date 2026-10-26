import type { Client, Transaction, TransactionMode } from "@libsql/client";

/**
 * Lifecycle guard for the EMBEDDED libSQL client (a `file:` URL), wrapped around the client handed to `@prisma/adapter-libsql`.
 *
 * WHY. Verified against the installed versions (@libsql/client 0.8.1, native libsql 0.3.19, @prisma/adapter-libsql 5.22.0):
 *  - The client runs every statement through `db.prepare(sql).run()`/`.all()`. When such a statement fails with SQLITE_BUSY the native
 *    statement is left un-reset. For a failed COMMIT that keeps the connection's lock for the life of the process: a later ROLLBACK
 *    "succeeds" (`inTransaction` becomes false) but the lock stays, and `close()` does not free it. The same COMMIT sent through
 *    `db.exec()` (what `Transaction.executeMultiple` uses) fails cleanly and a following ROLLBACK releases everything.
 *  - The embedded connection has no busy timeout, so a COMMIT that meets another connection's momentary read lock fails at once.
 *  Left alone, one such failure blocks every other writer of the file until that process restarts.
 *
 * WHAT. (1) every connection this guard sees (the one handed to a transaction and the fresh one opened after it) gets a busy timeout, so
 * a write or a commit waits for a short lock instead of failing at once (a statement run on the client's very first connection, before
 * any transaction has been started, has none);
 * (2) COMMIT is sent through `executeMultiple` (the exec path) and, if it still reports SQLITE_BUSY, is re-issued on the SAME open
 * transaction for a bounded time (SQLite leaves the transaction active after a BUSY COMMIT, so nothing has been committed and
 * re-issuing it cannot repeat any work); when the budget is spent the transaction is rolled back and the error is rethrown, so the
 * caller sees an ordinary failed commit. No statement, query or business operation is ever retried.
 *
 * LIMITS. While SQLite waits on the busy timeout the (synchronous) embedded driver blocks the process (see the constants below). It cannot
 * repair a statement that fails with SQLITE_BUSY INSIDE a transaction (a read-then-write upgrade is not covered by the busy timeout),
 * which is why the write routes begin with a write. It is applied only to embedded `file:` clients: a remote
 * Turso/libSQL client uses a different transport and is returned untouched. Nothing here has been run against a remote server.
 */

/**
 * The embedded driver is synchronous: while SQLite waits on the busy timeout the whole Node process is blocked (no other request in
 * that process runs). The values are therefore short, and they apply PER BLOCKING STATEMENT: a transaction can wait up to the busy
 * timeout for its first write and up to the commit budget for its COMMIT (about 4 s), and the request as a whole can take about 6 s
 * because the session-store write that ends it waits on the same lock.
 *
 * Prisma's own interactive-transaction timer (default 5 s, running in the compiled engine) is NOT paused while the driver blocks. MEASURED:
 * when that timer fires while the guard's synchronous COMMIT is still waiting and the commit then succeeds, Prisma reports P2028
 * ("transaction expired") although the change was applied (an uncertain outcome for the caller). With the defaults the margin over the
 * ~4 s bound is under a second, so the write routes pass `EMBEDDED_TRANSACTION_OPTIONS` (via `interactiveTransactionOptions` in prisma.ts),
 * which widens the limits for embedded databases only.
 */
export const EMBEDDED_BUSY_TIMEOUT_MS = 2000;
export const EMBEDDED_COMMIT_BUDGET_MS = 2000;
export const EMBEDDED_TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 8000 } as const;

/** Prisma `$transaction` options for a database URL: wider limits for an embedded libSQL file, `undefined` (Prisma's defaults) otherwise. */
export function interactiveTransactionOptionsFor(url: string | undefined): { timeout: number; maxWait: number } | undefined {
  return url && isEmbeddedLibsqlUrl(url) ? { ...EMBEDDED_TRANSACTION_OPTIONS } : undefined;
}

/** True for the URL forms the embedded (in-process) libSQL client serves. */
export const isEmbeddedLibsqlUrl = (url: string): boolean => /^file:/i.test(url.trim());

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isBusyError(err: unknown): boolean {
  const e = err as { code?: unknown; rawCode?: unknown; message?: unknown } | null;
  return !!e && (e.code === "SQLITE_BUSY" || e.rawCode === 5 || (typeof e.message === "string" && /database is locked|SQLITE_BUSY/i.test(e.message)));
}

export interface GuardOptions {
  busyTimeoutMs?: number;
  commitBudgetMs?: number;
}

/** COMMIT through the exec path, re-issued while the database reports BUSY, then rolled back cleanly if it never succeeds. */
export async function commitGuarded(tx: Pick<Transaction, "executeMultiple" | "rollback" | "closed">, budgetMs = EMBEDDED_COMMIT_BUDGET_MS): Promise<void> {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      // A re-issued COMMIT may only wait for what is LEFT of the budget (the connection's own busy timeout is a full 2 s), so the whole
      // commit is bounded by the budget plus a few milliseconds instead of by budget + one more full timeout.
      if (attempt > 0) await tx.executeMultiple(`PRAGMA busy_timeout = ${Math.max(1, Math.trunc(budgetMs - (Date.now() - started)))}`);
      await tx.executeMultiple("COMMIT");
      return;
    } catch (err) {
      const retryable = isBusyError(err) && !tx.closed && Date.now() - started < budgetMs;
      if (retryable) {
        await sleep(Math.min(5 * 2 ** attempt, 100));
        continue;
      }
      // Not committed: release the transaction's locks before reporting the failure (best effort; the original error is what matters).
      if (!tx.closed) await tx.rollback().catch(() => undefined);
      throw err;
    }
  }
}

function guardTransaction(tx: Transaction, opts: Required<GuardOptions>): Transaction {
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === "commit") return () => commitGuarded(target, opts.commitBudgetMs);
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Wraps an embedded libSQL client; returns the client unchanged for anything else (see `isEmbeddedLibsqlUrl`). */
export function guardEmbeddedLibsql(client: Client, url: string, options: GuardOptions = {}): Client {
  if (!isEmbeddedLibsqlUrl(url)) return client;
  const opts = { busyTimeoutMs: options.busyTimeoutMs ?? EMBEDDED_BUSY_TIMEOUT_MS, commitBudgetMs: options.commitBudgetMs ?? EMBEDDED_COMMIT_BUDGET_MS };
  const pragma = `PRAGMA busy_timeout = ${Math.trunc(opts.busyTimeoutMs)}`;
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "transaction") {
        return async (mode?: TransactionMode) => {
          const tx = await target.transaction(mode);
          try {
            // The transaction owns its own connection; the client opens a fresh one for its next statement, so both need the timeout.
            await tx.execute(pragma);
            await target.execute(pragma);
          } catch (err) {
            await tx.rollback().catch(() => undefined); // never hand back (or leak) a half-prepared transaction
            throw err;
          }
          return guardTransaction(tx, opts);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

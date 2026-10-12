import { Store } from "express-session";
import type { SessionData } from "express-session";
import type { PrismaClient } from "@prisma/client";

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;
/** At most this many expired rows are removed per sweep (a bounded, index-driven delete, never a table scan). */
export const SESSION_CLEANUP_BATCH = 500;
/** An instance sweeps at most this often; sweeps piggy-back on session writes (no timer: serverless-safe). */
export const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

function resolveExpiry(session: SessionData): Date {
  if (session.cookie?.expires) {
    return new Date(session.cookie.expires);
  }
  return new Date(Date.now() + DEFAULT_TTL_MS);
}

/**
 * express-session store backed by Prisma/SQLite instead of a second native
 * driver (avoids requiring a local C++ toolchain just to run `npm install`).
 */
export class PrismaSessionStore extends Store {
  private lastCleanupMs = 0;

  constructor(
    private prisma: PrismaClient,
    private clock: () => number = Date.now,
  ) {
    super();
  }

  get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    this.prisma.session
      .findUnique({ where: { id: sid } })
      .then((record) => {
        if (!record || record.expiresAt.getTime() < Date.now()) {
          callback(null, null);
          return;
        }
        callback(null, JSON.parse(record.data) as SessionData);
      })
      .catch((err: unknown) => callback(err));
  }

  set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    const data = JSON.stringify(session);
    const expiresAt = resolveExpiry(session);

    this.prisma.session
      .upsert({
        where: { id: sid },
        create: { id: sid, data, expiresAt },
        update: { data, expiresAt },
      })
      .then(() => this.maybeCleanup())
      .then(() => callback?.())
      .catch((err: unknown) => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    this.prisma.session
      .deleteMany({ where: { id: sid } })
      .then(() => callback?.())
      .catch((err: unknown) => callback?.(err));
  }

  touch(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    this.set(sid, session, callback);
  }

  /**
   * Removes up to `limit` rows already past their expiry and returns how many were deleted. Bounded (one
   * indexed batch) and safe for live sessions: the delete re-checks `expiresAt < now`, so a row refreshed
   * between the read and the delete is kept, and `get` already treats expired rows as absent.
   */
  async cleanupExpired(limit = SESSION_CLEANUP_BATCH, nowMs: number = this.clock()): Promise<number> {
    const now = new Date(nowMs);
    const rows = await this.prisma.session.findMany({ where: { expiresAt: { lt: now } }, select: { id: true }, take: limit });
    if (rows.length === 0) return 0;
    const result = await this.prisma.session.deleteMany({ where: { id: { in: rows.map((r) => r.id) }, expiresAt: { lt: now } } });
    return result.count;
  }

  /** At most one bounded sweep per interval per instance; a failure never affects the session write that triggered it. */
  private async maybeCleanup(): Promise<void> {
    const nowMs = this.clock();
    if (nowMs - this.lastCleanupMs < SESSION_CLEANUP_INTERVAL_MS) return;
    this.lastCleanupMs = nowMs;
    try {
      await this.cleanupExpired(SESSION_CLEANUP_BATCH, nowMs);
    } catch {
      console.error("[session] expired-session cleanup failed");
    }
  }
}

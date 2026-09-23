import { Store } from "express-session";
import type { SessionData } from "express-session";
import type { PrismaClient } from "@prisma/client";

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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
  constructor(private prisma: PrismaClient) {
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

  /** Removes rows past their expiry. Call periodically; cheap for a lab-sized site. */
  async cleanupExpired(): Promise<void> {
    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}

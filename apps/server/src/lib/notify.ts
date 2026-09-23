import type { Prisma, PrismaClient } from "@prisma/client";
import type { NotificationType } from "@scl/shared";

/**
 * Notification creation, reused by every feature that notifies a user (messaging, forum
 * mentions/replies/reactions/moderation — Phase 12 §19). Always call it INSIDE the same
 * transaction as the change that triggered it (Phase 8 §10 / Phase 12 §31), so a rolled-back
 * request never leaves an orphaned notification. `payload` must stay small and non-sensitive
 * (e.g. a post title, a reaction kind) — never a message body or other private free text.
 *
 * The value set for `type` lives in @scl/shared (schemas/notifications.ts) — the single source
 * of truth the API response schema also uses — not here.
 */
export type { NotificationType };

type NotifyDb = Prisma.TransactionClient | PrismaClient;

export interface NotifyEntry {
  userId: string;
  type: NotificationType;
  /** Who caused it; omitted for a system notification. */
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** App-relative link; must start with "/" or it is dropped (never an external URL). */
  targetPath?: string;
  /** Small non-sensitive JSON (a title, a kind) — never a message body or other free text. */
  payload?: Record<string, string | number | boolean | null>;
}

/** Never notifies the actor about their own action. */
export async function notify(db: NotifyDb, entry: NotifyEntry): Promise<void> {
  if (entry.actorId && entry.actorId === entry.userId) return;
  const targetPath = entry.targetPath && entry.targetPath.startsWith("/") ? entry.targetPath : "";
  await db.notification.create({
    data: {
      userId: entry.userId,
      type: entry.type,
      actorId: entry.actorId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      targetPath,
      payload: entry.payload ? JSON.stringify(entry.payload) : null,
    },
  });
}

/** Same as `notify`, for several recipients (e.g. everyone newly mentioned). Skips duplicates of the actor. */
export async function notifyMany(db: NotifyDb, userIds: string[], entry: Omit<NotifyEntry, "userId">): Promise<void> {
  for (const userId of new Set(userIds)) {
    await notify(db, { ...entry, userId });
  }
}

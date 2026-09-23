import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Append-only activity history: who did what, to which record, and when.
 *
 * Call it INSIDE the same transaction as the change it describes, so a change and
 * its audit row commit or roll back together and a rejected request leaves no trace:
 *
 *   await prisma.$transaction(async (tx) => {
 *     ...mutate...
 *     await recordAudit(tx, { actor: req.user!, action: "PROJECT_CREATED", entityType: "RESEARCH_PROJECT", entityId: id });
 *   });
 */
export type AuditAction =
  // accounts
  | "USER_CREATED"
  | "ROLE_CHANGED"
  | "USER_DELETED"
  // visibility (one row per change, on top of the ordinary *_UPDATED row)
  | "CONTENT_VISIBILITY_CHANGED"
  // curated content
  | "RESEARCH_CREATED"
  | "RESEARCH_UPDATED"
  | "RESEARCH_DELETED"
  | "PUBLICATION_CREATED"
  | "PUBLICATION_UPDATED"
  | "PUBLICATION_DELETED"
  | "PUBLICATION_AUTHORS_CHANGED"
  | "NEWS_CREATED"
  | "NEWS_UPDATED"
  | "NEWS_DELETED"
  | "NEWS_AUTHORS_CHANGED"
  // people
  | "TEAM_MEMBER_CREATED"
  | "TEAM_MEMBER_UPDATED"
  | "TEAM_MEMBER_DELETED"
  | "MEMBER_LINKS_CHANGED"
  // research projects
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_DELETED"
  | "PROJECT_MEMBERS_CHANGED"
  | "PROJECT_AREAS_CHANGED"
  | "PROJECT_PUBLICATIONS_CHANGED"
  | "PROJECT_NEWS_CHANGED"
  // research groups
  | "GROUP_CREATED"
  | "GROUP_UPDATED"
  | "GROUP_DELETED"
  | "GROUP_MEMBERS_CHANGED"
  // forum (Phase 11)
  | "FORUM_CATEGORY_CREATED"
  | "FORUM_CATEGORY_UPDATED"
  | "FORUM_CATEGORY_DELETED"
  | "FORUM_POST_CREATED"
  | "FORUM_POST_UPDATED"
  | "FORUM_POST_DELETED"
  | "FORUM_POST_PINNED"
  | "FORUM_POST_UNPINNED"
  | "FORUM_POST_LOCKED"
  | "FORUM_POST_UNLOCKED"
  | "FORUM_POST_HIDDEN"
  | "FORUM_POST_RESTORED"
  | "FORUM_POST_MOVED"
  | "FORUM_COMMENT_CREATED"
  | "FORUM_COMMENT_UPDATED"
  | "FORUM_COMMENT_DELETED"
  | "FORUM_COMMENT_HIDDEN"
  | "FORUM_COMMENT_RESTORED"
  // files + gallery (Phase 13)
  | "FILE_UPLOADED"
  | "FILE_DELETED"
  | "GALLERY_ITEM_CREATED"
  | "GALLERY_ITEM_UPDATED"
  | "GALLERY_ITEM_DELETED";

export type AuditEntityType =
  | "USER"
  | "RESEARCH_AREA"
  | "PUBLICATION"
  | "NEWS_ITEM"
  | "TEAM_MEMBER"
  | "RESEARCH_PROJECT"
  | "RESEARCH_GROUP"
  | "FORUM_CATEGORY"
  | "FORUM_POST"
  | "FORUM_COMMENT"
  | "STORED_FILE"
  | "GALLERY_ITEM";

type AuditDb = Prisma.TransactionClient | PrismaClient;
type AuditDetails = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  /** null for a system action with no acting account. */
  actor: { id: string; email: string } | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  /** Small, flat and non-sensitive: ids, roles, counts, field NAMES (never text values of long fields). See FORBIDDEN_KEY. */
  details?: AuditDetails;
}

/**
 * The audit log must never hold credentials or private content. `details` is only
 * ever built by our own code, so a match here is a programming error: fail loudly
 * (a test catches it) rather than write the value.
 */
const FORBIDDEN_KEY = /pass(word)?|hash|secret|token|cookie|session|body|content|message/i;
const MAX_DETAIL_LENGTH = 500;

export async function recordAudit(db: AuditDb, entry: AuditEntry): Promise<void> {
  const details: AuditDetails = {};
  for (const [key, value] of Object.entries(entry.details ?? {})) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`Audit details must not include "${key}".`);
    details[key] = typeof value === "string" && value.length > MAX_DETAIL_LENGTH ? value.slice(0, MAX_DETAIL_LENGTH) : value;
  }
  await db.auditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorEmail: entry.actor?.email ?? "",
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      details: Object.keys(details).length > 0 ? JSON.stringify(details) : null,
    },
  });
}

/** Names of the fields in `keys` whose value differs between `before` and `after` (comma-joined, for `details`). */
export function changedFields<T extends Record<string, unknown>>(before: T, after: Partial<T>, keys: (keyof T)[]): string {
  return keys.filter((k) => after[k] !== undefined && after[k] !== before[k]).join(",");
}

/** "a,b,c" for an id list, "" when empty (details values must be flat). */
export const idList = (ids: string[]): string => ids.join(",");

/**
 * Records CONTENT_VISIBILITY_CHANGED when `from !== to`. Call it in addition to
 * the entity's own *_UPDATED row so "who published this" is one query.
 */
export async function recordVisibilityChange(
  db: AuditDb,
  actor: AuditEntry["actor"],
  entityType: AuditEntityType,
  entityId: string,
  from: string,
  to: string | undefined,
): Promise<void> {
  if (to === undefined || to === from) return;
  await recordAudit(db, { actor, action: "CONTENT_VISIBILITY_CHANGED", entityType, entityId, details: { from, to } });
}

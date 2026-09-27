import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  ADMIN_CONTENT_TYPES,
  ADMIN_TRANSLATION_MAX,
  ID_PATTERN,
  TRANSLATABLE_FIELDS,
  adminAuditQuerySchema,
  adminContentQuerySchema,
  adminFilesQuerySchema,
  adminTranslationsQuerySchema,
  bulkVisibilitySchema,
  canAccessAdmin,
  canBulkChangeVisibility,
  canManageTranslations,
  canViewAccountAudit,
  canViewAuditLog,
  isAdmin,
  isTranslatableEntityType,
  updateTranslationSchema,
  type AdminAuditEntry,
  type AdminAuditResponse,
  type AdminCommunityResponse,
  type AdminContentType,
  type AdminCount,
  type AdminFilesResponse,
  type AdminOverview,
  type AdminTranslationEntry,
  type AdminTranslationsResponse,
  type BulkVisibilityResult,
  type TranslatableEntityType,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { requireCan } from "../middleware/auth.js";
import { HttpError, parseOrThrow } from "../lib/validate.js";
import { assertValidId } from "../lib/authorLinks.js";
import { recordAudit, type AuditAction, type AuditEntityType } from "../lib/audit.js";
import { applyTranslationOverrides, getEntityTranslations, resolveLocale } from "../lib/translations.js";
import { eventScopeWhere } from "../lib/eventSerializers.js";
import {
  ENTITY_TO_CONTENT_TYPE,
  VISIBILITY_TARGETS,
  contentDef,
  getAdminContentDetail,
  listAdminContent,
  paginate,
  textWhere,
} from "../lib/adminContent.js";

/**
 * Phase 17 admin / CMS API. A MANAGEMENT VIEW over the existing tables — no new tables, no new
 * powers: everything a manager can do here they could already do through the ordinary routes.
 *
 *  - The whole router requires `canAccessAdmin` (401 guests, 403 members).
 *  - Accounts stay in /api/users (ADMIN only); nothing here touches passwords, sessions, messages
 *    or notifications. There is deliberately no message/notification endpoint under /api/admin.
 *  - Queries are validated by strict zod schemas (bad enum/page/date/id = 400); a filter that does
 *    not apply to the chosen type is a 400, never silently ignored.
 *  - Nothing here returns `userId`, an email (except the ADMIN-only audit actor), a storage key or a
 *    filesystem path.
 */
const router = Router();
router.use(requireCan(canAccessAdmin));

// ---- overview ------------------------------------------------------------------------------------
type Grouped = { visibility: string; _count: { _all: number } }[];
function toCount(rows: Grouped): AdminCount {
  const of = (v: string) => rows.find((r) => r.visibility === v)?._count._all ?? 0;
  const total = rows.reduce((sum, r) => sum + r._count._all, 0);
  return { total, public: of("PUBLIC"), labOnly: total - of("PUBLIC") };
}

router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const viewer = req.user!;
    const group = <T extends { groupBy: (a: any) => Promise<any> }>(model: T, where?: object): Promise<Grouped> =>
      model.groupBy({ by: ["visibility"], where, _count: { _all: true } });

    const [areas, projects, groups, publications, news, events, upcoming, knowledgeDocs, labResources, categories, galleryRows, topics, teamMembers, overrides] = await Promise.all([
      group(prisma.researchArea),
      group(prisma.researchProject),
      group(prisma.researchGroup),
      group(prisma.publication),
      group(prisma.newsItem),
      group(prisma.event),
      prisma.event.count({ where: eventScopeWhere("upcoming", new Date()) }),
      group(prisma.knowledgeDoc),
      group(prisma.labResource),
      group(prisma.forumCategory),
      // A gallery item has no visibility of its own: its file's is the single source of truth.
      group(prisma.storedFile, { deletedAt: null, galleryItem: { isNot: null } }),
      prisma.forumPost.count({ where: { status: { not: "DELETED" } } }),
      prisma.teamMember.count(),
      prisma.translation.count({ where: { locale: "ja" } }),
    ]);

    let accounts: AdminOverview["accounts"] = null;
    if (isAdmin(viewer)) {
      const [byRole, unlinked] = await Promise.all([
        prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
        prisma.teamMember.count({ where: { userId: null } }),
      ]);
      const counts = new Map(byRole.map((r) => [r.role, r._count._all]));
      const n = (role: string) => counts.get(role) ?? 0;
      const total = byRole.reduce((sum, r) => sum + r._count._all, 0);
      // An unrecognised stored role is treated as MEMBER everywhere else (getSessionUser), so it counts as one here.
      accounts = { total, admins: n("ADMIN"), managers: n("LAB_MANAGER"), members: total - n("ADMIN") - n("LAB_MANAGER"), profilesWithoutLogin: unlinked };
    }

    const body: AdminOverview = {
      accounts,
      teamMembers,
      researchAreas: toCount(areas),
      projects: toCount(projects),
      groups: toCount(groups),
      publications: toCount(publications),
      news: toCount(news),
      events: { ...toCount(events), upcoming },
      knowledgeDocs: toCount(knowledgeDocs),
      labResources: toCount(labResources),
      forumCategories: toCount(categories),
      forumTopics: topics,
      galleryItems: toCount(galleryRows),
      translations: { overrides },
    };
    res.json(body);
  }),
);

// ---- content -----------------------------------------------------------------------------------------
// GET /api/admin/content?type=&q=&visibility=&owner=&scope=&kind=&status=&newsType=&translation=&from=&to=&sort=&page=&limit=
router.get(
  "/content",
  asyncHandler(async (req, res) => {
    const query = parseOrThrow(adminContentQuerySchema, req.query);
    res.json(await listAdminContent(query, req.user!, resolveLocale(req)));
  }),
);

// POST /api/admin/content/visibility -> bulk PUBLIC/LAB_ONLY for one type. All-or-nothing: an unknown id is a 404
// and nothing changes. Each changed record gets its ordinary *_UPDATED audit row AND a CONTENT_VISIBILITY_CHANGED row,
// exactly like changing it one at a time. Registered BEFORE the /:type/:id route so "visibility" is never read as a type.
router.post(
  "/content/visibility",
  requireCan(canBulkChangeVisibility),
  asyncHandler(async (req, res) => {
    const { type, ids, visibility } = parseOrThrow(bulkVisibilitySchema, req.body);
    const target = VISIBILITY_TARGETS[type];

    const result = await prisma.$transaction(async (tx): Promise<BulkVisibilityResult> => {
      const delegate = target.delegate(tx);
      const rows = await delegate.findMany({ where: { id: { in: ids } }, select: { id: true, visibility: true, [target.titleField]: true } });
      if (rows.length !== ids.length) throw new HttpError(404, "Not found");
      const changing = rows.filter((r) => r.visibility !== visibility);
      if (changing.length > 0) {
        await delegate.updateMany({ where: { id: { in: changing.map((r) => r.id) } }, data: { visibility } });
        for (const row of changing) {
          const title = String(row[target.titleField] ?? "");
          await recordAudit(tx, {
            actor: req.user!,
            action: target.action as AuditAction,
            entityType: target.entityType as AuditEntityType,
            entityId: row.id,
            details: { title, changed: "visibility", bulk: true },
          });
          await recordAudit(tx, {
            actor: req.user!,
            action: "CONTENT_VISIBILITY_CHANGED",
            entityType: target.entityType as AuditEntityType,
            entityId: row.id,
            details: { from: row.visibility, to: visibility, bulk: true },
          });
        }
      }
      return { updated: changing.length, unchanged: rows.length - changing.length };
    });
    res.json(result);
  }),
);

// GET /api/admin/content/:type/:id -> one record's summary, relationship counts and translation state
router.get(
  "/content/:type/:id",
  asyncHandler(async (req, res) => {
    const type = req.params.type as AdminContentType;
    if (!(ADMIN_CONTENT_TYPES as readonly string[]).includes(type)) throw new HttpError(404, "Not found");
    assertValidId(req.params.id);
    const detail = await getAdminContentDetail(type, req.params.id, req.user!, resolveLocale(req));
    if (!detail) throw new HttpError(404, "Not found");
    res.json(detail);
  }),
);

// ---- translations ------------------------------------------------------------------------------------
const PAGE_LABEL_FIELD: Record<TranslatableEntityType, string> = {
  RESEARCH_AREA: "title",
  RESEARCH_PROJECT: "title",
  RESEARCH_GROUP: "name",
  NEWS_ITEM: "title",
  EVENT: "title",
  KNOWLEDGE_DOC: "title",
  LAB_RESOURCE: "name",
  PUBLICATION: "title",
  TEAM_MEMBER: "name",
};

async function toTranslationEntries(entityType: TranslatableEntityType, rows: Record<string, unknown>[]): Promise<AdminTranslationEntry[]> {
  const fields = TRANSLATABLE_FIELDS[entityType] as readonly string[];
  const overrides = await prisma.translation.findMany({
    where: { entityType, entityId: { in: rows.map((r) => r.id as string) }, locale: "ja", field: { in: fields as string[] } },
    select: { entityId: true, field: true, value: true },
  });
  const byKey = new Map(overrides.map((o) => [`${o.entityId}\u0000${o.field}`, o.value]));
  const def = contentDef(ENTITY_TO_CONTENT_TYPE[entityType]);
  return rows.map((row) => ({
    entityType,
    id: row.id as string,
    label: String(row[PAGE_LABEL_FIELD[entityType]] ?? ""),
    href: def.base(row).href,
    fields: fields.map((field) => ({
      field,
      base: String(row[field] ?? ""),
      ja: byKey.get(`${row.id as string}\u0000${field}`) ?? null,
      max: ADMIN_TRANSLATION_MAX[entityType][field],
    })),
  }));
}

// GET /api/admin/translations?type=&q=&state=all|overridden|missing&page=&limit=
router.get(
  "/translations",
  requireCan(canManageTranslations),
  asyncHandler(async (req, res) => {
    const { type: entityType, q, state, page, limit } = parseOrThrow(adminTranslationsQuerySchema, req.query);
    const def = contentDef(ENTITY_TO_CONTENT_TYPE[entityType]);
    const and: Record<string, unknown>[] = [];
    const text = await textWhere(def, q.terms);
    if (text) and.push(text);
    if (state === "overridden" || state === "missing") {
      const rows = await prisma.translation.findMany({
        where: { entityType, locale: "ja", field: { in: TRANSLATABLE_FIELDS[entityType] as unknown as string[] } },
        select: { entityId: true },
        distinct: ["entityId"],
      });
      const ids = rows.map((r) => r.entityId);
      and.push({ id: state === "overridden" ? { in: ids } : { notIn: ids } });
    }
    const where = and.length > 0 ? { AND: and } : {};
    const [total, raws] = await Promise.all([def.count(where), def.find(where, [{ [def.titleField]: "asc" }, { id: "asc" }], (page - 1) * limit, limit)]);
    const body: AdminTranslationsResponse = { type: entityType, entries: await toTranslationEntries(entityType, raws), pagination: paginate(page, limit, total) };
    res.json(body);
  }),
);

// PUT /api/admin/translations/:entityType/:entityId  { field, value }  -> set (non-empty) or clear ("" / null) one Japanese override.
// Authorised like the entity's own edit (a manager may edit every translatable entity); never accepts a base-language write.
router.put(
  "/translations/:entityType/:entityId",
  requireCan(canManageTranslations),
  asyncHandler(async (req, res) => {
    const { entityType, entityId } = req.params;
    if (!isTranslatableEntityType(entityType)) throw new HttpError(404, "Not found");
    if (!ID_PATTERN.test(entityId)) throw new HttpError(400, "Invalid id.");
    const { field, value } = parseOrThrow(updateTranslationSchema, req.body);
    if (!(TRANSLATABLE_FIELDS[entityType] as readonly string[]).includes(field)) throw new HttpError(400, "That field can't be translated.");
    const max = ADMIN_TRANSLATION_MAX[entityType][field];
    if (value !== null && value.length > max) throw new HttpError(400, `Japanese ${field} must be at most ${max} characters.`);

    const def = contentDef(ENTITY_TO_CONTENT_TYPE[entityType]);
    await prisma.$transaction(async (tx) => {
      const exists = await def.find({ id: entityId }, [{ id: "asc" }], 0, 1);
      if (exists.length === 0) throw new HttpError(404, "Not found");
      const before = await getEntityTranslations(tx, entityType, entityId);
      await applyTranslationOverrides(tx, entityType, entityId, { [field]: value });
      const after = await getEntityTranslations(tx, entityType, entityId);
      if (after[field] !== before[field]) {
        // Field NAMES only, never the translated text (audit convention).
        await recordAudit(tx, {
          actor: req.user!,
          action: entityType === "EVENT" ? "EVENT_TRANSLATIONS_CHANGED" : "TRANSLATIONS_CHANGED",
          entityType: entityType as AuditEntityType,
          entityId,
          details: { locale: "ja", fields: field, cleared: after[field] === null },
        });
      }
    });

    const [row] = await def.find({ id: entityId }, [{ id: "asc" }], 0, 1);
    const [entry] = await toTranslationEntries(entityType, [row]);
    res.json(entry);
  }),
);

// ---- audit log -------------------------------------------------------------------------------------
/** Flat details as recorded. `keepEmails` is false for a manager: account events never reach them (filtered by entityType), and any detail
 *  named like an email is dropped too, so an address can never ride along on some other kind of row. */
function parseDetails(raw: string | null, keepEmails: boolean): AdminAuditEntry["details"] {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: AdminAuditEntry["details"] = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!keepEmails && /mail/i.test(k)) continue;
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// GET /api/admin/audit?action=&entityType=&actor=&from=&to=&page=&limit= (newest first, id as the tiebreaker)
router.get(
  "/audit",
  requireCan(canViewAuditLog),
  asyncHandler(async (req, res) => {
    const viewer = req.user!;
    const query = parseOrThrow(adminAuditQuerySchema, req.query);
    const admin = canViewAccountAudit(viewer);
    // Account events and actor emails are admin-only: a manager filtering by actor is refused, never silently ignored.
    if (query.actor !== undefined && query.actor !== "" && !admin) throw new HttpError(403, "Forbidden");

    const and: Prisma.AuditLogWhereInput[] = [];
    if (!admin) and.push({ entityType: { not: "USER" } });
    if (query.action) and.push({ action: query.action });
    if (query.entityType) and.push({ entityType: query.entityType });
    if (query.actor) and.push({ actorEmail: { contains: query.actor } });
    if (query.from || query.to) {
      and.push({ createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: new Date(query.to.getTime() + 86_400_000) } : {}) } });
    }
    const where: Prisma.AuditLogWhereInput = and.length > 0 ? { AND: and } : {};
    const visibleOnly: Prisma.AuditLogWhereInput = admin ? {} : { entityType: { not: "USER" } };

    const [total, rows, actions, entityTypes] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.auditLog.groupBy({ by: ["action"], where: visibleOnly, orderBy: { action: "asc" } }),
      prisma.auditLog.groupBy({ by: ["entityType"], where: visibleOnly, orderBy: { entityType: "asc" } }),
    ]);

    // A manager sees who acted as the person's PUBLIC profile name (never an account email).
    const names = new Map<string, string | null>();
    if (!admin) {
      const actorIds = Array.from(new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : []))));
      if (actorIds.length > 0) {
        const users = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, teamMember: { select: { name: true } } } });
        for (const u of users) names.set(u.id, u.teamMember?.name ?? null);
      }
    }

    const body: AdminAuditResponse = {
      entries: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actor: admin ? r.actorEmail || null : r.actorId ? (names.get(r.actorId) ?? null) : null,
        details: parseDetails(r.details, admin),
      })),
      pagination: paginate(query.page, query.limit, total),
      facets: { actions: actions.map((a) => a.action), entityTypes: entityTypes.map((e) => e.entityType) },
    };
    res.json(body);
  }),
);

// ---- community ---------------------------------------------------------------------------------------
// Counts and a list of hidden topics (title + where to review it). Never a post/comment BODY, and nothing that could
// edit someone's words: moderation itself stays in the forum (`canModerate`), where the author-edit rules live.
router.get(
  "/community",
  asyncHandler(async (_req, res) => {
    const [categories, hidden, events, galleryItems] = await Promise.all([
      prisma.forumCategory.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        select: { id: true, slug: true, name: true, visibility: true, isLocked: true },
      }),
      prisma.forumPost.findMany({
        where: { status: "HIDDEN" },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 20,
        select: { id: true, title: true, createdAt: true, category: { select: { name: true } }, author: { select: { teamMember: { select: { name: true } } } } },
      }),
      prisma.event.count(),
      prisma.galleryItem.count({ where: { file: { deletedAt: null } } }),
    ]);
    const perCategory = await Promise.all(
      categories.map(async (c) => {
        const [topics, hiddenTopics, comments, hiddenComments] = await Promise.all([
          prisma.forumPost.count({ where: { categoryId: c.id, status: { not: "DELETED" } } }),
          prisma.forumPost.count({ where: { categoryId: c.id, status: "HIDDEN" } }),
          prisma.forumComment.count({ where: { post: { categoryId: c.id }, status: { not: "DELETED" } } }),
          prisma.forumComment.count({ where: { post: { categoryId: c.id }, status: "HIDDEN" } }),
        ]);
        return { topics, hiddenTopics, comments, hiddenComments };
      }),
    );
    const body: AdminCommunityResponse = {
      categories: categories.map((c, i) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        visibility: c.visibility === "PUBLIC" ? "PUBLIC" : "LAB_ONLY",
        locked: c.isLocked,
        ...perCategory[i],
      })),
      hiddenTopics: hidden.map((p) => ({
        id: p.id,
        title: p.title,
        categoryName: p.category.name,
        author: p.author?.teamMember?.name ?? null,
        createdAt: p.createdAt.toISOString(),
        href: `/community/forum/topic/${p.id}`,
      })),
      events,
      galleryItems,
    };
    res.json(body);
  }),
);

// ---- files / gallery ----------------------------------------------------------------------------------
// Gallery metadata only. Never the storage key or a path: `id` is the gallery item's id and the bytes stay behind
// /api/files/:id and its own access check. Files attached to a MESSAGE (or any non-gallery file) are not listed at all.
router.get(
  "/files",
  asyncHandler(async (req, res) => {
    const query = parseOrThrow(adminFilesQuerySchema, req.query);
    const and: Prisma.GalleryItemWhereInput[] = [{ file: { deletedAt: null, entityType: null } }];
    if (query.visibility) and.push({ file: { visibility: query.visibility } });
    if (query.category) and.push({ category: query.category });
    if (query.q.terms.length > 0) {
      and.push({ AND: query.q.terms.map((term) => ({ OR: [{ caption: { contains: term } }, { file: { originalName: { contains: term } } }] })) });
    }
    const where: Prisma.GalleryItemWhereInput = { AND: and };
    const [total, rows] = await Promise.all([
      prisma.galleryItem.count({ where }),
      prisma.galleryItem.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          caption: true,
          category: true,
          createdAt: true,
          project: { select: { id: true, title: true } },
          file: { select: { originalName: true, mimeType: true, sizeBytes: true, visibility: true, owner: { select: { teamMember: { select: { id: true, name: true } } } } } },
        },
      }),
    ]);
    const body: AdminFilesResponse = {
      rows: rows.map((r) => ({
        id: r.id,
        originalName: r.file.originalName,
        mimeType: r.file.mimeType,
        sizeBytes: r.file.sizeBytes,
        caption: r.caption,
        category: r.category,
        visibility: r.file.visibility === "PUBLIC" ? "PUBLIC" : "LAB_ONLY",
        uploadedBy: r.file.owner?.teamMember ? { id: r.file.owner.teamMember.id, name: r.file.owner.teamMember.name } : null,
        project: r.project,
        createdAt: r.createdAt.toISOString(),
      })),
      pagination: paginate(query.page, query.limit, total),
    };
    res.json(body);
  }),
);

export default router;

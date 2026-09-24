import type { Prisma } from "@prisma/client";
import {
  ADMIN_TRANSLATION_ENTITY,
  TRANSLATABLE_FIELDS,
  isAdmin,
  type Actor,
  type AdminContentQuery,
  type AdminContentRow,
  type AdminContentType,
  type AdminPagination,
  type AdminVisibilityType,
  type Locale,
  type TranslatableEntityType,
  type Visibility,
} from "@scl/shared";
import { prisma } from "./prisma.js";
import { translationMatchIds } from "./search.js";
import { eventInclude, eventOrderBy, eventScopeWhere } from "./eventSerializers.js";


/**
 * Phase 17 content management: ONE listing engine over the existing curated-content tables.
 *
 * Nothing here decides who may look — the route guard (`canAccessAdmin`) does, and everyone who
 * passes it is a manager, who by the Phase 9 policy already sees every row of every one of these
 * tables. There is no generic content table: each type below is a thin adapter over its own model.
 *
 * Text search (`q`) is the global search's own recipe (`parseSearchText` words, AND across words, OR
 * across columns, Prisma `contains`, no raw SQL) plus the Japanese overrides through the SAME
 * `translationMatchIds` helper — always, whatever `X-Locale` says, so the answer can never depend on
 * the locale. Private data is not reachable from here: messages and notifications have no adapter.
 */

type Where = Record<string, unknown>;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Def {
  /** Set when the type has Japanese overrides. */
  entity?: TranslatableEntityType;
  titleField: string;
  textFields: string[];
  count: (where: Where) => Promise<number>;
  find: (where: Where, orderBy: Where[], skip: number, take: number) => Promise<Record<string, unknown>[]>;
  base: (row: any) => Pick<AdminContentRow, "title" | "subtitle" | "visibility" | "status" | "date" | "owner" | "href">;
  relations: (id: string) => Promise<{ key: string; count: number }[]>;
}

const vis = (row: { visibility: string }): Visibility => (row.visibility === "PUBLIC" ? "PUBLIC" : "LAB_ONLY");
const rel = async (entries: [string, Promise<number>][]) => Promise.all(entries.map(async ([key, p]) => ({ key, count: await p })));

const DEFS: Record<AdminContentType, Def> = {
  "research-area": {
    entity: "RESEARCH_AREA",
    titleField: "title",
    textFields: ["title", "description", "tag"],
    count: (where) => prisma.researchArea.count({ where }),
    find: (where, orderBy, skip, take) => prisma.researchArea.findMany({ where, orderBy: orderBy as Prisma.ResearchAreaOrderByWithRelationInput[], skip, take }),
    base: (r) => ({ title: r.title, subtitle: r.tag, visibility: vis(r), status: null, date: null, owner: null, href: "/research" }),
    relations: (id) =>
      rel([
        ["projects", prisma.projectArea.count({ where: { researchAreaId: id } })],
        ["researchers", prisma.researcherArea.count({ where: { researchAreaId: id } })],
      ]),
  },
  project: {
    entity: "RESEARCH_PROJECT",
    titleField: "title",
    textFields: ["title", "summary", "description", "slug"],
    count: (where) => prisma.researchProject.count({ where }),
    find: (where, orderBy, skip, take) => prisma.researchProject.findMany({ where, orderBy: orderBy as Prisma.ResearchProjectOrderByWithRelationInput[], skip, take }),
    base: (r) => ({ title: r.title, subtitle: r.slug, visibility: vis(r), status: r.status, date: null, owner: null, href: `/projects/${r.id}` }),
    relations: (id) =>
      rel([
        ["members", prisma.projectMember.count({ where: { projectId: id } })],
        ["areas", prisma.projectArea.count({ where: { projectId: id } })],
        ["publications", prisma.projectPublication.count({ where: { projectId: id } })],
        ["news", prisma.newsItem.count({ where: { projectId: id } })],
        ["events", prisma.event.count({ where: { projectId: id } })],
        ["gallery", prisma.galleryItem.count({ where: { projectId: id, file: { deletedAt: null } } })],
        ["forumTopics", prisma.forumPost.count({ where: { projectId: id, status: { not: "DELETED" } } })],
        ["groups", prisma.researchProject.count({ where: { id, groupId: { not: null } } })],
      ]),
  },
  group: {
    entity: "RESEARCH_GROUP",
    titleField: "name",
    textFields: ["name", "description", "slug"],
    count: (where) => prisma.researchGroup.count({ where }),
    find: (where, orderBy, skip, take) => prisma.researchGroup.findMany({ where, orderBy: orderBy as Prisma.ResearchGroupOrderByWithRelationInput[], skip, take }),
    base: (r) => ({ title: r.name, subtitle: r.slug, visibility: vis(r), status: null, date: null, owner: null, href: `/groups/${r.id}` }),
    relations: (id) =>
      rel([
        ["members", prisma.groupMember.count({ where: { groupId: id } })],
        ["projects", prisma.researchProject.count({ where: { groupId: id } })],
      ]),
  },
  publication: {
    titleField: "title",
    textFields: ["title", "authors", "venue"],
    count: (where) => prisma.publication.count({ where }),
    find: (where, orderBy, skip, take) => prisma.publication.findMany({ where, orderBy: orderBy as Prisma.PublicationOrderByWithRelationInput[], skip, take }),
    base: (r) => ({ title: r.title, subtitle: `${r.year} · ${r.venue}`, visibility: vis(r), status: null, date: null, owner: null, href: "/publications" }),
    relations: (id) =>
      rel([
        ["authors", prisma.publicationAuthor.count({ where: { publicationId: id } })],
        ["projects", prisma.projectPublication.count({ where: { publicationId: id } })],
      ]),
  },
  news: {
    entity: "NEWS_ITEM",
    titleField: "title",
    textFields: ["title", "description", "type"],
    count: (where) => prisma.newsItem.count({ where }),
    find: (where, orderBy, skip, take) => prisma.newsItem.findMany({ where, orderBy: orderBy as Prisma.NewsItemOrderByWithRelationInput[], skip, take }),
    base: (r) => ({ title: r.title, subtitle: r.dateLabel, visibility: vis(r), status: r.type, date: null, owner: null, href: "/news" }),
    relations: (id) =>
      rel([
        ["authors", prisma.newsAuthor.count({ where: { newsItemId: id } })],
        ["projects", prisma.newsItem.count({ where: { id, projectId: { not: null } } })],
      ]),
  },
  event: {
    entity: "EVENT",
    titleField: "title",
    textFields: ["title", "description", "location"],
    count: (where) => prisma.event.count({ where }),
    find: (where, orderBy, skip, take) =>
      prisma.event.findMany({ where, orderBy: orderBy as Prisma.EventOrderByWithRelationInput[], skip, take, include: eventInclude }),
    base: (r) => {
      const profile = r.createdBy?.teamMember ?? null;
      return {
        title: r.title,
        subtitle: r.location,
        visibility: vis(r),
        status: r.kind,
        date: (r.startsAt as Date).toISOString(),
        owner: profile ? { id: profile.id, name: profile.name } : null,
        href: `/events/${r.id}`,
      };
    },
    relations: (id) =>
      rel([
        ["gallery", prisma.galleryItem.count({ where: { eventId: id, file: { deletedAt: null } } })],
        ["projects", prisma.event.count({ where: { id, projectId: { not: null } } })],
      ]),
  },
  "team-member": {
    entity: "TEAM_MEMBER",
    titleField: "name",
    textFields: ["name", "role", "department", "bio"],
    count: (where) => prisma.teamMember.count({ where }),
    find: (where, orderBy, skip, take) => prisma.teamMember.findMany({ where, orderBy: orderBy as Prisma.TeamMemberOrderByWithRelationInput[], skip, take }),
    base: (r) => ({ title: r.name, subtitle: r.role, visibility: null, status: r.category, date: null, owner: null, href: `/team/${r.id}` }),
    relations: (id) =>
      rel([
        ["publications", prisma.publicationAuthor.count({ where: { teamMemberId: id } })],
        ["news", prisma.newsAuthor.count({ where: { teamMemberId: id } })],
        ["projects", prisma.projectMember.count({ where: { teamMemberId: id } })],
        ["groups", prisma.groupMember.count({ where: { teamMemberId: id } })],
        ["areas", prisma.researcherArea.count({ where: { teamMemberId: id } })],
        ["history", prisma.historyEntry.count({ where: { teamMemberId: id } })],
      ]),
  },
};

export const ENTITY_TO_CONTENT_TYPE = Object.fromEntries(
  (Object.entries(ADMIN_TRANSLATION_ENTITY) as [AdminContentType, TranslatableEntityType][]).map(([type, entity]) => [entity, type]),
) as Record<TranslatableEntityType, AdminContentType>;

export const contentDef = (type: AdminContentType) => DEFS[type];

export const paginate = (page: number, limit: number, total: number): AdminPagination => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

/** Every Japanese override's entity id for one type (a lab's worth of rows: small). */
async function overriddenIds(entity: TranslatableEntityType): Promise<string[]> {
  const rows = await prisma.translation.findMany({
    where: { entityType: entity, locale: "ja", field: { in: TRANSLATABLE_FIELDS[entity] as unknown as string[] } },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  return rows.map((r) => r.entityId);
}

/** Free-text WHERE: every word must appear in some column, or in a Japanese override. */
export async function textWhere(def: Def, terms: string[]): Promise<Where | null> {
  if (terms.length === 0) return null;
  const english = { AND: terms.map((term) => ({ OR: def.textFields.map((f) => ({ [f]: { contains: term } })) })) };
  if (!def.entity) return english;
  const ja = await translationMatchIds(def.entity, terms);
  return ja.size > 0 ? { OR: [english, { id: { in: Array.from(ja) } }] } : english;
}

async function buildWhere(query: AdminContentQuery, def: Def, now: Date): Promise<Where> {
  const and: Where[] = [];
  const text = await textWhere(def, query.q.terms);
  if (text) and.push(text);
  if (query.visibility) and.push({ visibility: query.visibility });
  if (query.status) and.push({ status: query.status });
  if (query.newsType) and.push({ type: query.newsType });
  if (query.kind) and.push({ kind: query.kind });
  if (query.owner) and.push({ createdBy: { teamMember: { id: query.owner } } });
  if (query.scope) and.push(eventScopeWhere(query.scope, now) as Where);
  if (query.from || query.to) {
    and.push({ updatedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: new Date(query.to.getTime() + DAY_MS) } : {}) } });
  }
  if (query.translation && def.entity) {
    const ids = await overriddenIds(def.entity);
    and.push({ id: query.translation === "translated" ? { in: ids } : { notIn: ids } });
  }
  return and.length > 0 ? { AND: and } : {};
}

function orderFor(query: AdminContentQuery, def: Def): Where[] {
  switch (query.sort) {
    case "title":
      return [{ [def.titleField]: "asc" }, { id: "asc" }];
    case "created":
      return [{ createdAt: "desc" }, { id: "asc" }];
    case "updated":
      return [{ updatedAt: "desc" }, { id: "asc" }];
    default:
      // Events read best by their own date (soonest first when looking ahead); everything else newest-edited first.
      return query.type === "event" ? (eventOrderBy(query.scope ?? "all") as Where[]) : [{ updatedAt: "desc" }, { id: "asc" }];
  }
}

/** Japanese overrides for a page of ids in ONE query (never one per row): entityId -> field -> value. */
async function jaFor(entity: TranslatableEntityType, ids: string[]) {
  const map = new Map<string, Record<string, string>>();
  if (ids.length === 0) return map;
  const rows = await prisma.translation.findMany({
    where: { entityType: entity, entityId: { in: ids }, locale: "ja" },
    select: { entityId: true, field: true, value: true },
  });
  const allowed = TRANSLATABLE_FIELDS[entity] as readonly string[];
  for (const r of rows) {
    if (!allowed.includes(r.field) || !r.value) continue;
    map.set(r.entityId, { ...(map.get(r.entityId) ?? {}), [r.field]: r.value });
  }
  return map;
}

function toRow(type: AdminContentType, def: Def, raw: Record<string, unknown>, ja: Map<string, Record<string, string>>, locale: Locale, actor: Actor): AdminContentRow {
  const id = raw.id as string;
  const overrides = ja.get(id) ?? {};
  // Show the title in the admin's own language where an override exists (same fallback rule as every other read).
  const shown = locale === "ja" && def.entity ? { ...raw, ...pickTranslated(def.entity, overrides) } : raw;
  const base = def.base(shown);
  return {
    type,
    id,
    ...base,
    translation: def.entity ? { done: Object.keys(overrides).length, total: (TRANSLATABLE_FIELDS[def.entity] as readonly string[]).length } : null,
    hasAccount: type === "team-member" && isAdmin(actor) ? raw.userId !== null : null,
    createdAt: (raw.createdAt as Date).toISOString(),
    updatedAt: (raw.updatedAt as Date).toISOString(),
  };
}

const pickTranslated = (entity: TranslatableEntityType, overrides: Record<string, string>) =>
  Object.fromEntries((TRANSLATABLE_FIELDS[entity] as readonly string[]).filter((f) => overrides[f]).map((f) => [f, overrides[f]]));

export async function listAdminContent(query: AdminContentQuery, actor: Actor, locale: Locale) {
  const def = DEFS[query.type];
  const where = await buildWhere(query, def, new Date());
  const [total, raws] = await Promise.all([def.count(where), def.find(where, orderFor(query, def), (query.page - 1) * query.limit, query.limit)]);
  const ja = def.entity ? await jaFor(def.entity, raws.map((r) => r.id as string)) : new Map<string, Record<string, string>>();
  return {
    type: query.type,
    rows: raws.map((raw) => toRow(query.type, def, raw, ja, locale, actor)),
    pagination: paginate(query.page, query.limit, total),
  };
}

export async function getAdminContentDetail(type: AdminContentType, id: string, actor: Actor, locale: Locale) {
  const def = DEFS[type];
  const [raw] = await def.find({ id }, [{ id: "asc" }], 0, 1);
  if (!raw) return null;
  const ja = def.entity ? await jaFor(def.entity, [id]) : new Map<string, Record<string, string>>();
  const overrides = ja.get(id) ?? {};
  return {
    row: toRow(type, def, raw, ja, locale, actor),
    relations: await def.relations(id),
    translations: def.entity ? (TRANSLATABLE_FIELDS[def.entity] as readonly string[]).map((field) => ({ field, hasOverride: Boolean(overrides[field]) })) : [],
  };
}

// ---- bulk visibility ------------------------------------------------------------------------------
type VisDelegate = {
  findMany(args: { where: { id: { in: string[] } }; select: Record<string, boolean> }): Promise<{ id: string; visibility: string; [k: string]: unknown }[]>;
  updateMany(args: { where: { id: { in: string[] } }; data: { visibility: string } }): Promise<{ count: number }>;
};

/** Per type: the model, the entity's ordinary "updated" audit row, its audit entity type and which column is its title. */
export const VISIBILITY_TARGETS: Record<
  AdminVisibilityType,
  { delegate: (tx: Prisma.TransactionClient) => VisDelegate; action: string; entityType: string; titleField: string }
> = {
  "research-area": { delegate: (tx) => tx.researchArea as unknown as VisDelegate, action: "RESEARCH_UPDATED", entityType: "RESEARCH_AREA", titleField: "title" },
  project: { delegate: (tx) => tx.researchProject as unknown as VisDelegate, action: "PROJECT_UPDATED", entityType: "RESEARCH_PROJECT", titleField: "title" },
  group: { delegate: (tx) => tx.researchGroup as unknown as VisDelegate, action: "GROUP_UPDATED", entityType: "RESEARCH_GROUP", titleField: "name" },
  publication: { delegate: (tx) => tx.publication as unknown as VisDelegate, action: "PUBLICATION_UPDATED", entityType: "PUBLICATION", titleField: "title" },
  news: { delegate: (tx) => tx.newsItem as unknown as VisDelegate, action: "NEWS_UPDATED", entityType: "NEWS_ITEM", titleField: "title" },
  event: { delegate: (tx) => tx.event as unknown as VisDelegate, action: "EVENT_UPDATED", entityType: "EVENT", titleField: "title" },
};

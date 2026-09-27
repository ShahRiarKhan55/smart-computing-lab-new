import type { Prisma } from "@prisma/client";
import {
  canDeleteKnowledge,
  canEditKnowledge,
  knowledgeCategorySchema,
  knowledgeExcerpt,
  type KnowledgeDocDetail,
  type KnowledgeDocSummary,
  type KnowledgeListQuery,
  type KnowledgeSection,
  type Locale,
} from "@scl/shared";
import { prisma } from "./prisma.js";
import { canView, visibilityField, visibleTo, type Viewer } from "./visibility.js";
import { loadRefTranslations, pick } from "./researchGraph.js";
import { loadTranslations, localize } from "./translations.js";
import { translationMatchIds } from "./search.js";

/**
 * Phase 22 research knowledge base: reads.
 *
 * VISIBILITY: a document is selected through the SAME `visibleTo(viewer)` fragment as every other
 * content table, IN the query (a hidden document is a missing one: counts, totals and pages are
 * computed after filtering). Its links to the research graph are shown ONLY when the viewer may see
 * the linked project / area / group, exactly like `serializeEvents`: a PUBLIC document that points at
 * a LAB_ONLY project never names that project to a guest. A relationship FILTER (`?project=`) demands
 * the linked record be visible too, so it cannot be used to discover which documents hang off a hidden one.
 *
 * `locale` only chooses which language's text comes back; it never changes which rows do.
 */

/** What every knowledge read needs: the relationship targets (title + visibility) and the author's public team profile. */
export const knowledgeInclude = {
  author: { select: { teamMember: { select: { id: true, name: true } } } },
  project: { select: { id: true, title: true, visibility: true } },
  researchArea: { select: { id: true, title: true, visibility: true } },
  group: { select: { id: true, name: true, visibility: true } },
  teamMember: { select: { id: true, name: true } },
} satisfies Prisma.KnowledgeDocInclude;

export type KnowledgeRow = Prisma.KnowledgeDocGetPayload<{ include: typeof knowledgeInclude }>;

/** Deterministic order: most recently edited first; `id` makes it total. */
export const knowledgeOrderBy: Prisma.KnowledgeDocOrderByWithRelationInput[] = [{ updatedAt: "desc" }, { id: "asc" }];

/**
 * Rows -> API shape for this viewer and locale. One batched translation lookup for the documents and
 * one per referenced kind for the related titles (never one per row; none at all for English).
 */
export async function serializeKnowledge(rows: KnowledgeRow[], viewer: Viewer, locale: Locale, detail: true): Promise<KnowledgeDocDetail[]>;
export async function serializeKnowledge(rows: KnowledgeRow[], viewer: Viewer, locale: Locale, detail?: false): Promise<KnowledgeDocSummary[]>;
export async function serializeKnowledge(rows: KnowledgeRow[], viewer: Viewer, locale: Locale, detail = false): Promise<KnowledgeDocSummary[] | KnowledgeDocDetail[]> {
  const seen = <T extends { visibility: string; id: string } | null>(r: T) => (r && canView(viewer, r.visibility) ? [r.id] : []);
  const [docTr, refTr] = await Promise.all([
    loadTranslations(prisma, "KNOWLEDGE_DOC", rows.map((r) => r.id), locale),
    loadRefTranslations(locale, {
      projects: rows.flatMap((r) => seen(r.project)),
      areas: rows.flatMap((r) => seen(r.researchArea)),
      groups: rows.flatMap((r) => seen(r.group)),
    }),
  ]);

  return rows.map((raw) => {
    const row = localize(raw, "KNOWLEDGE_DOC", docTr);
    const isOwner = viewer !== null && row.authorId !== null && row.authorId === viewer.id;
    const category = knowledgeCategorySchema.safeParse(row.category);
    const summary: KnowledgeDocSummary = {
      id: row.id,
      title: row.title,
      excerpt: knowledgeExcerpt(row.body),
      category: category.success ? category.data : "RESOURCE",
      author: row.author?.teamMember ? { id: row.author.teamMember.id, name: row.author.teamMember.name } : null,
      project: row.project && canView(viewer, row.project.visibility) ? { id: row.project.id, title: pick(refTr.project, row.project.id, "title", row.project.title) } : null,
      researchArea:
        row.researchArea && canView(viewer, row.researchArea.visibility) ? { id: row.researchArea.id, title: pick(refTr.area, row.researchArea.id, "title", row.researchArea.title) } : null,
      group: row.group && canView(viewer, row.group.visibility) ? { id: row.group.id, title: pick(refTr.group, row.group.id, "name", row.group.name) } : null,
      researcher: row.teamMember ? { id: row.teamMember.id, name: row.teamMember.name } : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      canEdit: canEditKnowledge(viewer, isOwner),
      canDelete: canDeleteKnowledge(viewer, isOwner),
      ...visibilityField(viewer, row.visibility),
    };
    return detail ? { ...summary, body: row.body } : summary;
  }) as KnowledgeDocSummary[] | KnowledgeDocDetail[];
}

/**
 * The projects / areas that "belong" to a researcher: their own projects, those of their groups, and
 * those in their areas (all must themselves be visible to the viewer). The very definitions the Phase 21
 * workspace uses for its events and news, so "my documentation" and "my workspace" agree.
 */
export function researcherScope(viewer: NonNullable<Viewer>, teamMemberId: string | null): Prisma.KnowledgeDocWhereInput[] {
  const own: Prisma.KnowledgeDocWhereInput[] = [{ authorId: viewer.id }];
  if (!teamMemberId) return own;
  const s = researcherRelations(viewer, teamMemberId);
  return [...own, { teamMemberId }, { project: s.projects }, { group: s.groups }, { researchArea: s.areas }];
}

/**
 * The projects / groups / areas that "belong" to a researcher (each itself visible to the viewer), as
 * where-fragments over those models. Shared by every "mine" scope (knowledge, resources) so they agree with the workspace.
 */
export function researcherRelations(viewer: NonNullable<Viewer>, teamMemberId: string) {
  const visible = visibleTo(viewer);
  const mine = { teamMemberId };
  const projects: Prisma.ResearchProjectWhereInput = {
    ...visible,
    OR: [
      { members: { some: mine } },
      { group: { ...visible, members: { some: mine } } },
      { areaLinks: { some: { researchArea: { ...visible, researcherLinks: { some: mine } } } } },
    ],
  };
  const groups: Prisma.ResearchGroupWhereInput = { ...visible, members: { some: mine } };
  const areas: Prisma.ResearchAreaWhereInput = {
    ...visible,
    OR: [{ researcherLinks: { some: mine } }, { projectLinks: { some: { project: { ...visible, members: { some: mine } } } } }],
  };
  return { projects, groups, areas };
}

/** WHERE for `GET /api/knowledge` (visibility + every filter). The caller has already authorised `visibility` / `mine`. */
export async function knowledgeWhere(query: KnowledgeListQuery, viewer: Viewer): Promise<Prisma.KnowledgeDocWhereInput> {
  const visible = visibleTo(viewer);
  const and: Prisma.KnowledgeDocWhereInput[] = [visible];
  if (query.category) and.push({ category: query.category });
  if (query.visibility) and.push({ visibility: query.visibility });
  if (query.project) and.push({ projectId: query.project, project: visible });
  if (query.area) and.push({ researchAreaId: query.area, researchArea: visible });
  if (query.group) and.push({ groupId: query.group, group: visible });
  if (query.researcher) and.push({ teamMemberId: query.researcher });
  if (query.q.terms.length > 0) {
    const english: Prisma.KnowledgeDocWhereInput = {
      AND: query.q.terms.map((term) => ({ OR: [{ title: { contains: term } }, { body: { contains: term } }] })),
    };
    const ja = await translationMatchIds("KNOWLEDGE_DOC", query.q.terms);
    and.push(ja.size > 0 ? { OR: [english, { id: { in: Array.from(ja) } }] } : english);
  }
  if (query.mine && viewer) {
    const me = await prisma.teamMember.findUnique({ where: { userId: viewer.id }, select: { id: true } });
    and.push({ OR: researcherScope(viewer, me?.id ?? null) });
  }
  return { AND: and };
}

/** One bounded page + the total, for a research page or the workspace (`take` rows, deterministic order). */
export async function loadKnowledgeSection(where: Prisma.KnowledgeDocWhereInput, viewer: Viewer, locale: Locale, take: number): Promise<KnowledgeSection> {
  const [rows, total] = await Promise.all([
    prisma.knowledgeDoc.findMany({ where, include: knowledgeInclude, orderBy: knowledgeOrderBy, take }),
    prisma.knowledgeDoc.count({ where }),
  ]);
  return { items: await serializeKnowledge(rows, viewer, locale), total };
}

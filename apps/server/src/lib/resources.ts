import type { Prisma } from "@prisma/client";
import {
  RESOURCE_CARD_PROJECTS,
  RESOURCE_PROJECTS_MAX,
  RESOURCE_TYPE_METADATA,
  asResourceType,
  canDeleteResource,
  canEditResource,
  parseResourceMetadata,
  resourceExcerpt,
  safeResourceUrl,
  type Locale,
  type ResourceDetail,
  type ResourceListQuery,
  type ResourceMetadata,
  type ResourceRef,
  type ResourceSection,
  type ResourceSummary,
  type ResourceType,
} from "@scl/shared";
import { prisma } from "./prisma.js";
import { canView, visibilityField, visibleTo, type Viewer } from "./visibility.js";
import { personVisibleWhere, selfProfileIdIfNeeded, visibleAttribution } from "./hiddenPeople.js";
import { loadRefTranslations, pick } from "./researchGraph.js";
import { loadTranslations, localize } from "./translations.js";
import { translationMatchIds } from "./search.js";
import { researcherRelations } from "./knowledge.js";

/**
 * Phase 23 lab resources: reads.
 *
 * VISIBILITY: a resource is selected through the SAME `visibleTo(viewer)` fragment as every other content
 * table, IN the query (a hidden resource is a missing one: counts, totals and pages are computed after
 * filtering). Its links to the research graph (projects, area, group, document, publication, event) are shown
 * ONLY when the viewer may see the linked record: a PUBLIC resource that points at a LAB_ONLY project names
 * none of it to a guest (title *or* id). A relationship FILTER (`?project=`) demands the linked record be
 * visible too, so it cannot be used to discover which resources hang off a hidden one.
 *
 * COST: a list is 2 queries (rows with their visible project links and the filtered project count, and the total);
 * Japanese adds at most 3 batched Translation lookups for the list and 6 for a detail. Never per row.
 * `locale` only chooses which language's text comes back; it never changes which rows do.
 */

/** Read-side include for a viewer: owner/researcher profiles, related records (title + visibility) and the visible projects. */
export const resourceInclude = (viewer: Viewer, projectTake: number) => {
  const visible = visibleTo(viewer);
  return {
    owner: { select: { teamMember: { select: { id: true, name: true, isPublished: true } } } },
    teamMember: { select: { id: true, name: true, isPublished: true } },
    researchArea: { select: { id: true, title: true, visibility: true } },
    group: { select: { id: true, name: true, visibility: true } },
    knowledgeDoc: { select: { id: true, title: true, visibility: true } },
    publication: { select: { id: true, title: true, visibility: true } },
    event: { select: { id: true, title: true, visibility: true } },
    projectLinks: {
      where: { project: visible },
      orderBy: [{ project: { sortOrder: "asc" } }, { project: { title: "asc" } }, { projectId: "asc" }],
      take: projectTake,
      select: { project: { select: { id: true, title: true } } },
    },
    _count: { select: { projectLinks: { where: { project: visible } } } },
  } satisfies Prisma.LabResourceInclude;
};

export type ResourceRow = Prisma.LabResourceGetPayload<{ include: ReturnType<typeof resourceInclude> }>;

/** The include for a list card (a few project names) and for a detail page (all of them). */
export const listInclude = (viewer: Viewer) => resourceInclude(viewer, RESOURCE_CARD_PROJECTS);
export const detailInclude = (viewer: Viewer) => resourceInclude(viewer, RESOURCE_PROJECTS_MAX);

/** Deterministic order: most recently edited first; `id` makes it total. */
export const resourceOrderBy: Prisma.LabResourceOrderByWithRelationInput[] = [{ updatedAt: "desc" }, { id: "asc" }];

/** The metadata column as stored: allow-listed keys in a fixed order, `null` when empty. */
export function metadataToStored(type: ResourceType, metadata: Record<string, string>): string | null {
  const ordered: Record<string, string> = {};
  for (const key of RESOURCE_TYPE_METADATA[type]) if (metadata[key]) ordered[key] = metadata[key];
  return Object.keys(ordered).length > 0 ? JSON.stringify(ordered) : null;
}

export async function serializeResources(rows: ResourceRow[], viewer: Viewer, locale: Locale, detail: true): Promise<ResourceDetail[]>;
export async function serializeResources(rows: ResourceRow[], viewer: Viewer, locale: Locale, detail?: false): Promise<ResourceSummary[]>;
export async function serializeResources(rows: ResourceRow[], viewer: Viewer, locale: Locale, detail = false): Promise<ResourceSummary[] | ResourceDetail[]> {
  const seen = <T extends { visibility: string; id: string } | null>(r: T) => (r && canView(viewer, r.visibility) ? [r.id] : []);
  const [resTr, refTr, docTr, pubTr, eventTr, selfId] = await Promise.all([
    loadTranslations(prisma, "LAB_RESOURCE", rows.map((r) => r.id), locale),
    loadRefTranslations(locale, {
      projects: rows.flatMap((r) => r.projectLinks.map((l) => l.project.id)),
      areas: rows.flatMap((r) => seen(r.researchArea)),
      groups: rows.flatMap((r) => seen(r.group)),
    }),
    detail ? loadTranslations(prisma, "KNOWLEDGE_DOC", rows.flatMap((r) => seen(r.knowledgeDoc)), locale) : new Map<string, Record<string, string>>(),
    detail ? loadTranslations(prisma, "PUBLICATION", rows.flatMap((r) => seen(r.publication)), locale) : new Map<string, Record<string, string>>(),
    detail ? loadTranslations(prisma, "EVENT", rows.flatMap((r) => seen(r.event)), locale) : new Map<string, Record<string, string>>(),
    selfProfileIdIfNeeded(viewer, rows.flatMap((r) => [r.owner?.teamMember, r.teamMember])),
  ]);

  const ref = (r: { id: string; title: string; visibility: string } | null, tr: Map<string, Record<string, string>>): ResourceRef | null =>
    r && canView(viewer, r.visibility) ? { id: r.id, title: pick(tr, r.id, "title", r.title) } : null;

  return rows.map((raw) => {
    const row = localize(raw, "LAB_RESOURCE", resTr);
    const isOwner = viewer !== null && row.ownerId !== null && row.ownerId === viewer.id;
    const type = asResourceType(row.resourceType);
    const projects = row.projectLinks.map((l) => ({ id: l.project.id, title: pick(refTr.project, l.project.id, "title", l.project.title) }));
    const summary: ResourceSummary = {
      id: row.id,
      name: row.name,
      resourceType: type,
      version: row.version,
      vendor: row.vendor,
      identifier: row.identifier,
      url: safeResourceUrl(row.url),
      excerpt: resourceExcerpt(row.description),
      owner: visibleAttribution(viewer, row.owner?.teamMember, selfId),
      researcher: visibleAttribution(viewer, row.teamMember, selfId),
      projects: detail ? projects : projects.slice(0, RESOURCE_CARD_PROJECTS),
      projectCount: row._count.projectLinks,
      researchArea:
        row.researchArea && canView(viewer, row.researchArea.visibility) ? { id: row.researchArea.id, title: pick(refTr.area, row.researchArea.id, "title", row.researchArea.title) } : null,
      group: row.group && canView(viewer, row.group.visibility) ? { id: row.group.id, title: pick(refTr.group, row.group.id, "name", row.group.name) } : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      canEdit: canEditResource(viewer, isOwner),
      canDelete: canDeleteResource(viewer, isOwner),
      ...visibilityField(viewer, row.visibility),
    };
    if (!detail) return summary;
    const metadata: ResourceMetadata = parseResourceMetadata(row.metadata, type);
    const full: ResourceDetail = {
      ...summary,
      description: row.description,
      environment: row.environment,
      metadata,
      knowledgeDoc: ref(row.knowledgeDoc, docTr),
      publication: ref(row.publication, pubTr),
      event: ref(row.event, eventTr),
    };
    return full;
  }) as ResourceSummary[] | ResourceDetail[];
}

/**
 * Resources that "belong" to a researcher: ones they own or are named on, and ones linked to their projects,
 * groups and areas (all visible to the viewer). The very definitions the Phase 21 workspace and Phase 22
 * knowledge use, so "my resources" and "my workspace" agree.
 */
export function resourceScope(viewer: NonNullable<Viewer>, teamMemberId: string | null): Prisma.LabResourceWhereInput[] {
  const own: Prisma.LabResourceWhereInput[] = [{ ownerId: viewer.id }];
  if (!teamMemberId) return own;
  const s = researcherRelations(viewer, teamMemberId);
  return [...own, { teamMemberId }, { projectLinks: { some: { project: s.projects } } }, { group: s.groups }, { researchArea: s.areas }];
}

/** WHERE for `GET /api/resources` (visibility + every filter). The caller has already authorised `visibility` / `mine`. */
export async function resourceWhere(query: ResourceListQuery, viewer: Viewer): Promise<Prisma.LabResourceWhereInput> {
  const visible = visibleTo(viewer);
  const and: Prisma.LabResourceWhereInput[] = [visible];
  if (query.type) and.push({ resourceType: query.type });
  if (query.visibility) and.push({ visibility: query.visibility });
  if (query.project) and.push({ projectLinks: { some: { projectId: query.project, project: visible } } });
  if (query.area) and.push({ researchAreaId: query.area, researchArea: visible });
  if (query.group) and.push({ groupId: query.group, group: visible });
  if (query.researcher) and.push({ teamMemberId: query.researcher, teamMember: personVisibleWhere(viewer) });
  if (query.knowledge) and.push({ knowledgeDocId: query.knowledge, knowledgeDoc: visible });
  if (query.publication) and.push({ publicationId: query.publication, publication: visible });
  if (query.q.terms.length > 0) {
    const english: Prisma.LabResourceWhereInput = {
      AND: query.q.terms.map((term) => ({
        OR: RESOURCE_SEARCH_FIELDS.map((f) => ({ [f]: { contains: term } }) as Prisma.LabResourceWhereInput),
      })),
    };
    const ja = await translationMatchIds("LAB_RESOURCE", query.q.terms);
    and.push(ja.size > 0 ? { OR: [english, { id: { in: Array.from(ja) } }] } : english);
  }
  if (query.mine && viewer) {
    const me = await prisma.teamMember.findUnique({ where: { userId: viewer.id }, select: { id: true } });
    and.push({ OR: resourceScope(viewer, me?.id ?? null) });
  }
  return { AND: and };
}

/** The text columns a word may match (the global search and the list filter use the same set). */
export const RESOURCE_SEARCH_FIELDS = ["name", "description", "resourceType", "vendor", "identifier", "version", "environment"] as const;

/** One bounded page + the total, for a research page or the workspace (`take` rows, deterministic order). */
export async function loadResourceSection(where: Prisma.LabResourceWhereInput, viewer: Viewer, locale: Locale, take: number): Promise<ResourceSection> {
  const [rows, total] = await Promise.all([
    prisma.labResource.findMany({ where, include: listInclude(viewer), orderBy: resourceOrderBy, take }),
    prisma.labResource.count({ where }),
  ]);
  return { items: await serializeResources(rows, viewer, locale), total };
}

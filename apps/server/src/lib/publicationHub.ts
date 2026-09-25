import type { Prisma } from "@prisma/client";
import {
  DEFAULT_LOCALE,
  PUBLICATION_DEFAULT_LIMIT,
  PUBLICATION_RELATED_LIMIT,
  canDeleteContent,
  canEditContent,
  type Locale,
  type PublicationDetail,
  type PublicationListQuery,
  type PublicationListResponse,
} from "@scl/shared";
import { prisma } from "./prisma.js";
import { canView, visibleTo, type Viewer } from "./visibility.js";
import { loadProjectNewsAndEvents, loadRefTranslations, localizedPublications, pick } from "./researchGraph.js";
import { translationMatchIds } from "./search.js";
import { asProjectStatus, toPublication } from "./serializers.js";
import { loadTranslations, localize } from "./translations.js";

/**
 * Phase 19: the publication knowledge hub. Reads only, over tables that already exist:
 *
 *  - direct links: PublicationAuthor (researchers) and ProjectPublication (projects);
 *  - DERIVED links: research areas, groups, news and events are reached THROUGH the publication's
 *    visible projects, because the schema links those to Project only (there is no
 *    ResearchAreaPublication / GroupPublication table, and none was added).
 *
 * Every read uses the same `visibleTo(viewer)` fragment as the rest of the API. A project (and any
 * area/group behind it) that the viewer may not see is excluded IN the query, so a hidden record can
 * neither appear nor be counted, and a filter on a hidden or unknown id simply matches nothing — the
 * answer is the same for both. `locale` selects text only; it never changes which rows come back.
 */

const orderBy = (sort: PublicationListQuery["sort"]): Prisma.PublicationOrderByWithRelationInput[] => {
  switch (sort) {
    case "oldest":
      return [{ year: "asc" }, { createdAt: "asc" }, { id: "asc" }];
    case "title":
      return [{ title: "asc" }, { year: "desc" }, { id: "asc" }];
    default:
      return [{ year: "desc" }, { createdAt: "desc" }, { id: "asc" }];
  }
};

/** Words AND-ed, each matched against title/authors/venue/linked researcher names (and the year for a 4-digit word). */
function textWhere(terms: string[], translatedIds: Set<string> | null): Prisma.PublicationWhereInput | null {
  if (terms.length === 0) return null;
  const english: Prisma.PublicationWhereInput = {
    AND: terms.map((term) => ({
      OR: [
        { title: { contains: term } },
        { authors: { contains: term } },
        { venue: { contains: term } },
        { authorLinks: { some: { teamMember: { name: { contains: term } } } } },
        ...(/^\d{4}$/.test(term) ? [{ year: Number(term) }] : []),
      ],
    })),
  };
  return translatedIds && translatedIds.size > 0 ? { OR: [english, { id: { in: Array.from(translatedIds) } }] } : english;
}

export async function browsePublications(query: PublicationListQuery, viewer: Viewer, locale: Locale): Promise<PublicationListResponse> {
  const visible = visibleTo(viewer);
  const page = query.page ?? 1;
  const limit = query.limit ?? PUBLICATION_DEFAULT_LIMIT;

  const and: Prisma.PublicationWhereInput[] = [visible];
  if (query.year !== undefined) and.push({ year: query.year });
  if (query.visibility) and.push({ visibility: query.visibility });
  if (query.researcher) and.push({ authorLinks: { some: { teamMemberId: query.researcher } } });

  // One linked project must satisfy every project-side filter, and only a project the viewer may see counts.
  if (query.project || query.area || query.group) {
    const project: Prisma.ResearchProjectWhereInput = {
      ...visible,
      ...(query.area ? { areaLinks: { some: { researchAreaId: query.area, researchArea: visible } } } : {}),
      ...(query.group ? { groupId: query.group, group: visible } : {}),
    };
    and.push({ projectLinks: { some: { ...(query.project ? { projectId: query.project } : {}), project } } });
  }

  const terms = query.q?.terms ?? [];
  const translatedIds = terms.length > 0 && locale !== DEFAULT_LOCALE ? await translationMatchIds("PUBLICATION", terms) : null;
  const text = textWhere(terms, translatedIds);
  if (text) and.push(text);
  const where: Prisma.PublicationWhereInput = { AND: and };

  const [total, rows, yearRows] = await Promise.all([
    prisma.publication.count({ where }),
    prisma.publication.findMany({ where, orderBy: orderBy(query.sort), skip: (page - 1) * limit, take: limit }),
    prisma.publication.findMany({ where: visible, select: { year: true }, distinct: ["year"], orderBy: { year: "desc" } }),
  ]);

  return {
    items: await localizedPublications(rows, viewer, locale),
    total,
    page,
    limit,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    years: yearRows.map((r) => r.year),
  };
}

/** One publication and what it is linked to, or null when it does not exist OR the viewer may not see it. */
export async function loadPublicationDetail(id: string, viewer: Viewer, locale: Locale): Promise<PublicationDetail | null> {
  const visible = visibleTo(viewer);
  const row = await prisma.publication.findFirst({
    where: { id, ...visible },
    include: {
      authorLinks: { include: { teamMember: { select: { id: true, name: true, initials: true, role: true, sortOrder: true } } } },
      projectLinks: {
        where: { project: visible },
        include: {
          project: {
            select: {
              id: true,
              slug: true,
              title: true,
              status: true,
              sortOrder: true,
              group: { select: { id: true, slug: true, name: true, sortOrder: true, visibility: true } },
              areaLinks: {
                where: { researchArea: visible },
                include: { researchArea: { select: { id: true, icon: true, title: true, tag: true, sortOrder: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!row) return null;

  const projects = row.projectLinks.map((l) => l.project).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const areaMap = new Map(projects.flatMap((p) => p.areaLinks.map((l) => [l.researchArea.id, l.researchArea] as const)));
  const groupMap = new Map(projects.flatMap((p) => (p.group && canView(viewer, p.group.visibility) ? [[p.group.id, p.group] as const] : [])));
  const areas = [...areaMap.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const groups = [...groupMap.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const [own, refs, related] = await Promise.all([
    loadTranslations(prisma, "PUBLICATION", [row.id], locale),
    loadRefTranslations(locale, { projects: projects.map((p) => p.id), areas: areas.map((a) => a.id), groups: groups.map((g) => g.id) }),
    loadProjectNewsAndEvents(projects.map((p) => p.id), viewer, locale, PUBLICATION_RELATED_LIMIT),
  ]);

  return {
    ...toPublication(localize(row, "PUBLICATION", own), viewer),
    researchers: row.authorLinks
      .map((l) => l.teamMember)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((m) => ({ id: m.id, name: m.name, initials: m.initials, role: m.role })),
    projects: projects.map((p) => ({ id: p.id, slug: p.slug, title: pick(refs.project, p.id, "title", p.title), status: asProjectStatus(p.status) })),
    areas: areas.map((a) => ({ id: a.id, icon: a.icon, title: pick(refs.area, a.id, "title", a.title), tag: a.tag })),
    groups: groups.map((g) => ({ id: g.id, slug: g.slug, name: pick(refs.group, g.id, "name", g.name) })),
    ...related,
    canEdit: canEditContent(viewer),
    canDelete: canDeleteContent(viewer),
  };
}

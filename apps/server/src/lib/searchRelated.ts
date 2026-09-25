import { SEARCH_RELATED_MAX, type Locale, type SearchRelated, type SearchResult, type SearchType } from "@scl/shared";
import { prisma } from "./prisma.js";
import { canView, visibleTo, type Viewer } from "./visibility.js";
import { loadRefTranslations, pick } from "./researchGraph.js";

/**
 * Phase 20: relationship context on search results ("this publication belongs to project X").
 *
 * VISIBILITY: every related record is selected through the SAME `visibleTo(viewer)` fragment (or
 * `canView` for a to-one relation) as the ordinary endpoints, so a hidden area/project/group can
 * never be named on a visible result, and its absence is indistinguishable from "no relation".
 * Relations are only ever the real ones (schema: Project<->Area, Project->Group, Publication<->Project,
 * Researcher<->Area, News/Event->Project); nothing is derived beyond that.
 *
 * COST: one query per result TYPE present on the page (at most 7), each on the entity's own model and
 * keyed by the ids already returned, plus at most one Translation query per referenced kind for a
 * Japanese request. Never per result.
 */

interface Ref {
  type: SearchRelated["type"];
  id: string;
  title: string;
  sortOrder: number;
}

const byOrder = (a: Ref, b: Ref) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

const HREF: Record<SearchRelated["type"], string> = { "research-area": "/research/", project: "/projects/", group: "/groups/" };

/** Related refs per result id, for the entity types that have any. */
async function loadRefs(type: SearchType, ids: string[], viewer: Viewer): Promise<Map<string, Ref[]>> {
  const visible = visibleTo(viewer);
  const out = new Map<string, Ref[]>();
  const project = { select: { id: true, title: true, sortOrder: true } } as const;
  const area = { select: { id: true, title: true, sortOrder: true } } as const;
  const asProject = (p: { id: string; title: string; sortOrder: number }): Ref => ({ type: "project", id: p.id, title: p.title, sortOrder: p.sortOrder });
  const asArea = (a: { id: string; title: string; sortOrder: number }): Ref => ({ type: "research-area", id: a.id, title: a.title, sortOrder: a.sortOrder });

  switch (type) {
    case "research-area": {
      const rows = await prisma.researchArea.findMany({ where: { id: { in: ids } }, select: { id: true, projectLinks: { where: { project: visible }, select: { project } } } });
      for (const r of rows) out.set(r.id, r.projectLinks.map((l) => asProject(l.project)));
      break;
    }
    case "project": {
      const rows = await prisma.researchProject.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          group: { select: { id: true, name: true, sortOrder: true, visibility: true } },
          areaLinks: { where: { researchArea: visible }, select: { researchArea: area } },
        },
      });
      for (const r of rows) {
        const refs: Ref[] = r.areaLinks.map((l) => asArea(l.researchArea));
        // The group leads the list (it is the project's home); an inaccessible group is simply absent.
        const group: Ref[] = r.group && canView(viewer, r.group.visibility) ? [{ type: "group", id: r.group.id, title: r.group.name, sortOrder: -1 }] : [];
        out.set(r.id, [...group, ...refs]);
      }
      break;
    }
    case "group": {
      const rows = await prisma.researchGroup.findMany({ where: { id: { in: ids } }, select: { id: true, projects: { where: visible, select: { id: true, title: true, sortOrder: true } } } });
      for (const r of rows) out.set(r.id, r.projects.map(asProject));
      break;
    }
    case "researcher": {
      const rows = await prisma.teamMember.findMany({ where: { id: { in: ids } }, select: { id: true, areaLinks: { where: { researchArea: visible }, select: { researchArea: area } } } });
      for (const r of rows) out.set(r.id, r.areaLinks.map((l) => asArea(l.researchArea)));
      break;
    }
    case "publication": {
      const rows = await prisma.publication.findMany({ where: { id: { in: ids } }, select: { id: true, projectLinks: { where: { project: visible }, select: { project } } } });
      for (const r of rows) out.set(r.id, r.projectLinks.map((l) => asProject(l.project)));
      break;
    }
    case "news":
    case "event": {
      const select = { id: true, project: { select: { id: true, title: true, sortOrder: true, visibility: true } } } as const;
      const rows = type === "news" ? await prisma.newsItem.findMany({ where: { id: { in: ids } }, select }) : await prisma.event.findMany({ where: { id: { in: ids } }, select });
      for (const r of rows) out.set(r.id, r.project && canView(viewer, r.project.visibility) ? [asProject(r.project)] : []);
      break;
    }
    default:
      break; // forum topics already show their category/project in `meta`
  }
  return out;
}

/** Adds `related` (deterministic order, at most SEARCH_RELATED_MAX, titles in the request's locale) to each result that has any. */
export async function attachRelated(results: SearchResult[], viewer: Viewer, locale: Locale): Promise<SearchResult[]> {
  if (results.length === 0) return results;
  const idsByType = new Map<SearchType, string[]>();
  for (const r of results) idsByType.set(r.type, [...(idsByType.get(r.type) ?? []), r.id]);
  const types = [...idsByType.keys()];
  const loaded = await Promise.all(types.map((type) => loadRefs(type, idsByType.get(type)!, viewer)));
  const refsByType = new Map(types.map((type, i) => [type, loaded[i]] as const));

  const kept = new Map<string, Ref[]>(); // `${type}:${id}` -> refs in (sortOrder, title, id) order, capped
  for (const [type, map] of refsByType) {
    for (const [id, refs] of map) kept.set(`${type}:${id}`, [...refs].sort(byOrder).slice(0, SEARCH_RELATED_MAX));
  }
  const all = [...kept.values()].flat();
  const tr = await loadRefTranslations(locale, {
    areas: all.filter((r) => r.type === "research-area").map((r) => r.id),
    projects: all.filter((r) => r.type === "project").map((r) => r.id),
    groups: all.filter((r) => r.type === "group").map((r) => r.id),
  });
  const title = (r: Ref) => (r.type === "research-area" ? pick(tr.area, r.id, "title", r.title) : r.type === "project" ? pick(tr.project, r.id, "title", r.title) : pick(tr.group, r.id, "name", r.title));

  return results.map((res) => {
    const refs = kept.get(`${res.type}:${res.id}`);
    if (!refs || refs.length === 0) return res;
    return { ...res, related: refs.map((r) => ({ type: r.type, id: r.id, title: title(r), href: `${HREF[r.type]}${r.id}` })) };
  });
}

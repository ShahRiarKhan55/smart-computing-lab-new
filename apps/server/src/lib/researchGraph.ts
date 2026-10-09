import type { Locale, LabEvent, NewsItem, Publication } from "@scl/shared";
import { prisma } from "./prisma.js";
import { visibleTo, type Viewer } from "./visibility.js";
import { eventInclude, serializeEvents } from "./eventSerializers.js";
import { loadTranslations, localize } from "./translations.js";
import { toNewsItem, toPublication } from "./serializers.js";
import { hiddenNamesFor, redactNames } from "./hiddenPeople.js";

/**
 * Phase 18: the research graph (Area -> Project -> Group -> Researcher) is read through the SAME
 * `visibleTo(viewer)` fragment as every other read. Nothing here decides visibility on its own, and
 * nothing here is reachable except from a route that already resolved its own parent's visibility:
 *
 *  - a related row is selected only when the viewer may see it, IN the query (never filtered after);
 *  - a count is the length of an already-filtered list, so a hidden record cannot be counted;
 *  - publications/news/events "of an area/group" are those of its VISIBLE projects, because that is
 *    the only real relationship: the schema links them to Project, not to Area or Group.
 *
 * `locale` only chooses which language's text comes back; it never changes which rows do.
 */

/** A lab's worth of rows; bounds a page that rolls several projects up without paging UI. */
export const ROLLUP_LIMIT = 100;

export interface ProjectOutputs {
  publications: Publication[];
  news: NewsItem[];
  events: LabEvent[];
}

/** Publications, news and events linked to any of `projectIds` (which the caller has ALREADY filtered to visible projects). */
export async function loadProjectOutputs(projectIds: string[], viewer: Viewer, locale: Locale): Promise<ProjectOutputs> {
  if (projectIds.length === 0) return { publications: [], news: [], events: [] };
  const visible = visibleTo(viewer);
  const [pubs, news, events] = await Promise.all([
    prisma.publication.findMany({
      where: { ...visible, projectLinks: { some: { projectId: { in: projectIds } } } },
      orderBy: [{ year: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: ROLLUP_LIMIT,
    }),
    prisma.newsItem.findMany({
      where: { ...visible, projectId: { in: projectIds } },
      orderBy: [{ sortDate: "desc" }, { id: "asc" }],
      take: ROLLUP_LIMIT,
    }),
    prisma.event.findMany({
      where: { ...visible, projectId: { in: projectIds } },
      include: eventInclude,
      orderBy: [{ startsAt: "desc" }, { id: "asc" }],
      take: ROLLUP_LIMIT,
    }),
  ]);
  const newsTr = await loadTranslations(prisma, "NEWS_ITEM", news.map((n) => n.id), locale);
  return {
    publications: await localizedPublications(pubs, viewer, locale),
    news: news.map((n) => toNewsItem(localize(n, "NEWS_ITEM", newsTr), viewer)),
    events: await serializeEvents(events, viewer, locale),
  };
}

/** Publication rows -> API shape with the locale's title/venue overrides (one batched lookup, none for English). */
export async function localizedPublications<T extends Parameters<typeof toPublication>[0] & { id: string }>(rows: T[], viewer: Viewer, locale: Locale): Promise<Publication[]> {
  const [tr, hidden] = await Promise.all([loadTranslations(prisma, "PUBLICATION", rows.map((r) => r.id), locale), hiddenNamesFor(viewer)]);
  return rows.map((r) => {
    const p = toPublication(localize(r, "PUBLICATION", tr), viewer);
    return hidden.length > 0 ? { ...p, authors: redactNames(p.authors, hidden) } : p;
  });
}

/** News and events of any of `projectIds` (already filtered to visible projects by the caller), newest first, at most `take` each. */
export async function loadProjectNewsAndEvents(projectIds: string[], viewer: Viewer, locale: Locale, take: number): Promise<{ news: NewsItem[]; events: LabEvent[] }> {
  if (projectIds.length === 0) return { news: [], events: [] };
  const visible = visibleTo(viewer);
  const [news, events] = await Promise.all([
    prisma.newsItem.findMany({ where: { ...visible, projectId: { in: projectIds } }, orderBy: [{ sortDate: "desc" }, { id: "asc" }], take }),
    prisma.event.findMany({ where: { ...visible, projectId: { in: projectIds } }, include: eventInclude, orderBy: [{ startsAt: "desc" }, { id: "asc" }], take }),
  ]);
  return { news: await localizedNews(news, viewer, locale), events: await serializeEvents(events, viewer, locale) };
}

/** News rows -> API shape with the locale's overrides (news titles/descriptions are translatable). */
export async function localizedNews<T extends Parameters<typeof toNewsItem>[0] & { id: string }>(rows: T[], viewer: Viewer, locale: Locale): Promise<NewsItem[]> {
  const tr = await loadTranslations(prisma, "NEWS_ITEM", rows.map((r) => r.id), locale);
  return rows.map((r) => toNewsItem(localize(r, "NEWS_ITEM", tr), viewer));
}

/** Japanese overrides for the related entities a page names, in one query per entity type (none for English). */
export interface RefTranslations {
  area: Map<string, Record<string, string>>;
  project: Map<string, Record<string, string>>;
  group: Map<string, Record<string, string>>;
}

export async function loadRefTranslations(
  locale: Locale,
  ids: { areas?: Iterable<string>; projects?: Iterable<string>; groups?: Iterable<string> },
): Promise<RefTranslations> {
  const uniq = (v?: Iterable<string>) => Array.from(new Set(v ?? []));
  const [area, project, group] = await Promise.all([
    loadTranslations(prisma, "RESEARCH_AREA", uniq(ids.areas), locale),
    loadTranslations(prisma, "RESEARCH_PROJECT", uniq(ids.projects), locale),
    loadTranslations(prisma, "RESEARCH_GROUP", uniq(ids.groups), locale),
  ]);
  return { area, project, group };
}

/** The locale's override of one field, or the English value when there is none. */
export const pick = (map: Map<string, Record<string, string>>, id: string, field: string, fallback: string): string => map.get(id)?.[field] || fallback;

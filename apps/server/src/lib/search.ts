import type { Prisma } from "@prisma/client";
import {
  DEFAULT_LOCALE,
  PROJECT_STATUS_LABELS,
  SEARCH_TYPES,
  isManager,
  plainTextForumBody,
  translatableFieldsOf,
  type Locale,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
  type SearchType,
  type TranslatableEntityType,
} from "@scl/shared";
import { prisma } from "./prisma.js";
import { asProjectStatus, toIsoDate } from "./serializers.js";
import { canView, visibilityField, visibleTo, type Viewer } from "./visibility.js";
import { visibleForumStatus } from "./forumSerializers.js";
import { loadTranslations, localize } from "./translations.js";
import { attachRelated } from "./searchRelated.js";

/**
 * Global search (Phase 10). Plain SQLite `LIKE` through Prisma's `contains` / `startsWith`:
 * no FTS5, no raw SQL, no second visibility system.
 *
 * VISIBILITY: every entity that has a `visibility` column is filtered by the SAME
 * `visibleTo(viewer)` the ordinary list endpoints use, inside the SAME query that counts and
 * fetches. Counts, totals and pagination are therefore computed after visibility filtering, and
 * a hidden row is indistinguishable from a missing one.
 *
 * NESTED VISIBILITY: an entity is matched ONLY by its own columns (plus data that is public to
 * every viewer: a publication's linked authors, a researcher's history entries). A group is never
 * matched because of its projects, nor a project because of its group, and no result carries any
 * relationship (group, project, member, count), so a match on a hidden record can never surface
 * a visible record that merely points at it. (Phase 20 adds the display-only `related` links of
 * searchRelated.ts to the RETURNED rows; they are read through the same visibleTo() and never take
 * part in matching, counting or ordering, so they cannot change which records a query finds.)
 *
 * ORDER (documented in docs/architecture/phase10-global-search.md): results are sorted by
 *   1. tier      0 = title/name STARTS WITH the whole query, 1 = title/name contains every word,
 *                2 = matched only through other fields
 *   2. type      research-area, project, group, researcher, publication, news
 *   3. the type's own order (title/name A-Z; publications newest year first; news newest first)
 *   4. id        (final tiebreaker, so the order is total and repeatable)
 * This is a documented deterministic ordering, not relevance scoring.
 */

type Tier = "t0" | "t1" | "t2";
const TIERS: Tier[] = ["t0", "t1", "t2"];

/** A search word list as `parseSearchText` produced it. */
type Words = Pick<SearchQuery, "phrase" | "terms">;

interface SourceDef<W extends object, R extends { id: string }> {
  type: SearchType;
  /** The column that is the result's title; ranking looks at it first. */
  title: Extract<keyof W, string>;
  /** Other text columns that are searched. */
  fields: Extract<keyof W, string>[];
  /** Extra "this word appears in ..." conditions. Only data that is public to EVERY viewer. */
  extra?: (term: string) => W[];
  /** The visibility restriction; `{}` for tables with no visibility column. */
  base: (viewer: Viewer) => W;
  count: (where: W) => Promise<number>;
  find: (where: W, skip: number, take: number) => Promise<R[]>;
  toResult: (row: R, viewer: Viewer, terms: string[]) => SearchResult;
  /** Present only for the entity types the Phase 14 `Translation` table covers (§4's allow-list).
   *  When the search request's locale is Japanese, this both (a) lets a Japanese override be
   *  MATCHED, on top of the English columns above, and (b) shows that override's text in the
   *  result, exactly like the entity's own GET already does (Phase 14 `localize()`) — a search
   *  result is never "found in Japanese, shown in English". */
  translatable?: TranslatableEntityType;
}

interface SourcePlan {
  count: (part: "all" | Tier) => Promise<number>;
  rows: (tier: Tier, skip: number, take: number) => Promise<SearchResult[]>;
}

const like = <W>(field: string, op: "contains" | "startsWith", value: string) => ({ [field]: { [op]: value } }) as unknown as W;

/**
 * The ids of `entityType` rows whose Japanese `Translation` override contains EVERY search term
 * (each term may land in a different translatable field — the same AND-across-terms/OR-across-
 * fields semantics `wheres()` uses for the English columns below). One query per term, same
 * multiplicity as the English side's own `anyField` (§10's own "no FTS5, no raw SQL" constraint —
 * this is plain `contains`, nothing new). Never called for an English-locale search: Phase 14 never
 * stores English in `Translation`, so there would be nothing to find (§4).
 */
export async function translationMatchIds(entityType: TranslatableEntityType, terms: string[]): Promise<Set<string>> {
  const fields = translatableFieldsOf(entityType) as string[];
  let matched: Set<string> | null = null;
  for (const term of terms) {
    const rows = await prisma.translation.findMany({
      where: { entityType, locale: "ja", field: { in: fields }, value: { contains: term } },
      select: { entityId: true },
    });
    const ids = new Set(rows.map((r) => r.entityId));
    if (matched === null) {
      matched = ids;
    } else {
      const prev: Set<string> = matched;
      matched = new Set(Array.from(prev).filter((id) => ids.has(id)));
    }
    if (matched.size === 0) return matched;
  }
  return matched ?? new Set();
}

/** Builds the WHERE for "everything that matches" and for each ranking tier (tiers are disjoint).
 *  `translatedIds`, when given, are OR'd into the match — but NEVER into `t0`/`t1`: those tiers
 *  rank by the ENGLISH title column, which a translation-only match never satisfies, so it always
 *  ranks as t2 ("matched only through other fields"), exactly like an English body-only match does.
 *  It is still ANDed with `base` here like everything else, so locale can never widen visibility. */
function wheres<W extends object, R extends { id: string }>(def: SourceDef<W, R>, viewer: Viewer, { phrase, terms }: Words, translatedIds: Set<string> | null) {
  const base = def.base(viewer);
  const anyField = (term: string) => ({
    OR: [...[def.title, ...def.fields].map((f) => like<W>(f, "contains", term)), ...(def.extra?.(term) ?? [])],
  });
  const englishMatch = { AND: terms.map(anyField) };
  const byTranslation = translatedIds && translatedIds.size > 0 ? [{ id: { in: Array.from(translatedIds) } } as unknown as W] : [];
  const anyMatch = byTranslation.length > 0 ? { OR: [englishMatch, ...byTranslation] } : englishMatch;
  const titleHasAll = { AND: terms.map((t) => like<W>(def.title, "contains", t)) };
  const prefix = like<W>(def.title, "startsWith", phrase);
  return {
    all: { AND: [base, anyMatch] } as W,
    t0: { AND: [base, prefix] } as W, // starting with the phrase implies containing every word
    t1: { AND: [base, titleHasAll, { NOT: prefix }] } as W,
    t2: { AND: [base, anyMatch, { NOT: titleHasAll }] } as W,
  };
}

function defineSource<W extends object, R extends { id: string }>(def: SourceDef<W, R>) {
  return {
    type: def.type,
    translatable: def.translatable,
    async plan(viewer: Viewer, words: Words, locale: Locale): Promise<SourcePlan> {
      const translatedIds = def.translatable && locale !== DEFAULT_LOCALE ? await translationMatchIds(def.translatable, words.terms) : null;
      const w = wheres(def, viewer, words, translatedIds);
      return {
        count: (part) => def.count(w[part]),
        rows: async (tier, skip, take) => {
          const rows = await def.find(w[tier], skip, take);
          const translated =
            def.translatable && locale !== DEFAULT_LOCALE
              ? await loadTranslations(
                  prisma,
                  def.translatable,
                  rows.map((r) => r.id),
                  locale,
                )
              : new Map<string, Record<string, string>>();
          return rows.map((row) => def.toResult(def.translatable ? localize(row, def.translatable, translated) : row, viewer, words.terms));
        },
      };
    },
  };
}

// ---- result text ------------------------------------------------------------------
const hasTerm = (text: string, terms: string[]) => {
  const lower = text.toLowerCase();
  return terms.some((t) => lower.includes(t.toLowerCase()));
};

/** A short plain-text excerpt, starting a little before the first matching word. */
export function excerpt(text: string, terms: string[], max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  const hits = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0);
  const first = hits.length > 0 ? Math.min(...hits) : 0;
  const lead = Math.floor(max / 4);
  if (first <= lead) return `${flat.slice(0, max).trimEnd()}…`;
  const start = first - lead;
  const end = start + max;
  return `…${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

/** The first candidate that contains a search word, else the first non-empty one. */
function describe(candidates: string[], terms: string[]): string {
  const text = candidates.find((c) => c && hasTerm(c, terms)) ?? candidates.find(Boolean) ?? "";
  return excerpt(text, terms);
}

const joinMeta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

function dateRange(start: Date | null, end: Date | null): string {
  const s = toIsoDate(start);
  const e = toIsoDate(end);
  return s && e ? `${s} – ${e}` : s ? `since ${s}` : e ? `until ${e}` : "";
}

// ---- the six searchable entities ----------------------------------------------------------
const sources = [
  defineSource<Prisma.ResearchAreaWhereInput, { id: string; title: string; description: string; tag: string; visibility: string }>({
    type: "research-area",
    title: "title",
    fields: ["description", "tag"],
    translatable: "RESEARCH_AREA",
    base: visibleTo,
    count: (where) => prisma.researchArea.count({ where }),
    find: (where, skip, take) =>
      prisma.researchArea.findMany({
        where,
        skip,
        take,
        orderBy: [{ title: "asc" }, { id: "asc" }],
        select: { id: true, title: true, description: true, tag: true, visibility: true },
      }),
    toResult: (r, viewer, terms) => ({
      type: "research-area",
      id: r.id,
      title: r.title,
      description: describe([r.description], terms),
      meta: r.tag,
      href: `/research/${r.id}`,
      ...visibilityField(viewer, r.visibility),
    }),
  }),

  defineSource<
    Prisma.ResearchProjectWhereInput,
    { id: string; title: string; summary: string; description: string; status: string; startDate: Date | null; endDate: Date | null; visibility: string }
  >({
    type: "project",
    title: "title",
    fields: ["slug", "summary", "description"],
    translatable: "RESEARCH_PROJECT",
    base: visibleTo,
    count: (where) => prisma.researchProject.count({ where }),
    find: (where, skip, take) =>
      prisma.researchProject.findMany({
        where,
        skip,
        take,
        orderBy: [{ title: "asc" }, { id: "asc" }],
        select: { id: true, title: true, summary: true, description: true, status: true, startDate: true, endDate: true, visibility: true },
      }),
    toResult: (r, viewer, terms) => ({
      type: "project",
      id: r.id,
      title: r.title,
      description: describe([r.summary, r.description], terms),
      meta: joinMeta(PROJECT_STATUS_LABELS[asProjectStatus(r.status)] ?? r.status, dateRange(r.startDate, r.endDate)),
      href: `/projects/${r.id}`,
      ...visibilityField(viewer, r.visibility),
    }),
  }),

  defineSource<Prisma.ResearchGroupWhereInput, { id: string; name: string; description: string; visibility: string }>({
    type: "group",
    title: "name",
    fields: ["slug", "description"],
    translatable: "RESEARCH_GROUP",
    base: visibleTo,
    count: (where) => prisma.researchGroup.count({ where }),
    find: (where, skip, take) =>
      prisma.researchGroup.findMany({
        where,
        skip,
        take,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, description: true, visibility: true },
      }),
    toResult: (r, viewer, terms) => ({
      type: "group",
      id: r.id,
      title: r.name,
      description: describe([r.description], terms),
      meta: "",
      href: `/groups/${r.id}`,
      ...visibilityField(viewer, r.visibility),
    }),
  }),

  // TeamMember has no `visibility` column: a profile is public unless a manager unpublished it
  // (`isPublished`, Phase 27), in which case only managers/admins find it — the same rule /api/team applies.
  // Never selected or searched: userId, the linked account, its email.
  defineSource<Prisma.TeamMemberWhereInput, { id: string; name: string; role: string; department: string; bio: string }>({
    type: "researcher",
    title: "name",
    fields: ["role", "department", "bio"],
    extra: (term) => [{ historyEntries: { some: { OR: [{ title: { contains: term } }, { description: { contains: term } }] } } }],
    translatable: "TEAM_MEMBER",
    base: (viewer) => (isManager(viewer) ? {} : { isPublished: true }),
    count: (where) => prisma.teamMember.count({ where }),
    find: (where, skip, take) =>
      prisma.teamMember.findMany({
        where,
        skip,
        take,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, role: true, department: true, bio: true },
      }),
    toResult: (r, _viewer, terms) => ({
      type: "researcher",
      id: r.id,
      title: r.name,
      description: describe([r.bio], terms),
      meta: joinMeta(r.role, r.department),
      href: `/team/${r.id}`,
    }),
  }),

  defineSource<Prisma.PublicationWhereInput, { id: string; year: number; title: string; authors: string; venue: string; visibility: string }>({
    type: "publication",
    title: "title",
    fields: ["authors", "venue", "doiUrl"],
    translatable: "PUBLICATION",
    // A researcher's name finds their linked publications; a 4-digit word also matches the year.
    extra: (term) => [
      { authorLinks: { some: { teamMember: { name: { contains: term } } } } },
      ...(/^\d{4}$/.test(term) ? [{ year: Number(term) }] : []),
    ],
    base: visibleTo,
    count: (where) => prisma.publication.count({ where }),
    find: (where, skip, take) =>
      prisma.publication.findMany({
        where,
        skip,
        take,
        orderBy: [{ year: "desc" }, { title: "asc" }, { id: "asc" }],
        select: { id: true, year: true, title: true, authors: true, venue: true, visibility: true },
      }),
    toResult: (r, viewer, terms) => ({
      type: "publication",
      id: r.id,
      title: r.title,
      description: describe([r.authors], terms),
      meta: joinMeta(String(r.year), r.venue),
      href: `/publications/${r.id}`,
      ...visibilityField(viewer, r.visibility),
    }),
  }),

  defineSource<Prisma.NewsItemWhereInput, { id: string; dateLabel: string; type: string; title: string; description: string; visibility: string }>({
    type: "news",
    title: "title",
    fields: ["description", "type"],
    translatable: "NEWS_ITEM",
    base: visibleTo,
    count: (where) => prisma.newsItem.count({ where }),
    find: (where, skip, take) =>
      prisma.newsItem.findMany({
        where,
        skip,
        take,
        orderBy: [{ sortDate: "desc" }, { title: "asc" }, { id: "asc" }],
        select: { id: true, dateLabel: true, type: true, title: true, description: true, visibility: true },
      }),
    toResult: (r, viewer, terms) => ({
      type: "news",
      id: r.id,
      title: r.title,
      description: describe([r.description], terms),
      meta: joinMeta(r.type, r.dateLabel),
      href: "/news",
      ...visibilityField(viewer, r.visibility),
    }),
  }),

  // Visibility lives on the CATEGORY, not the post (Phase 11 §9): `base` filters through the
  // SAME visibleTo() on the linked category, plus the same ACTIVE/HIDDEN status rule every forum
  // read endpoint uses (visibleForumStatus). A HIDDEN topic is therefore invisible to search for
  // everyone but a manager, exactly like the ordinary forum endpoints.
  defineSource<
    Prisma.ForumPostWhereInput,
    {
      id: string;
      title: string;
      body: string;
      category: { name: string; visibility: string };
      project: { title: string; visibility: string } | null;
      author: { teamMember: { name: string } | null } | null;
    }
  >({
    type: "forum-topic",
    title: "title",
    fields: ["body"],
    base: (viewer) => ({ category: visibleTo(viewer), ...visibleForumStatus(viewer) }),
    count: (where) => prisma.forumPost.count({ where }),
    find: (where, skip, take) =>
      prisma.forumPost.findMany({
        where,
        skip,
        take,
        orderBy: [{ title: "asc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          body: true,
          category: { select: { name: true, visibility: true } },
          project: { select: { title: true, visibility: true } },
          author: { select: { teamMember: { select: { name: true } } } },
        },
      }),
    toResult: (r, viewer, terms) => ({
      type: "forum-topic",
      id: r.id,
      title: r.title,
      description: describe([plainTextForumBody(r.body)], terms),
      meta: joinMeta(r.category.name, r.author?.teamMember?.name ?? "Former member", r.project && canView(viewer, r.project.visibility) ? r.project.title : undefined),
      href: `/community/forum/topic/${r.id}`,
      ...visibilityField(viewer, r.category.visibility),
    }),
  }),

  // Events (Phase 16): own `visibility` column, so the SAME visibleTo() as news/projects. The linked
  // project is never searched or returned, so a hidden project can't surface (or be inferred from) an
  // event. The meta line is language-neutral (ISO date + location) so a Japanese result has no English words.
  defineSource<
    Prisma.EventWhereInput,
    { id: string; title: string; description: string; location: string; startsAt: Date; visibility: string }
  >({
    type: "event",
    title: "title",
    fields: ["description", "location"],
    translatable: "EVENT",
    base: visibleTo,
    count: (where) => prisma.event.count({ where }),
    find: (where, skip, take) =>
      prisma.event.findMany({
        where,
        skip,
        take,
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        select: { id: true, title: true, description: true, location: true, startsAt: true, visibility: true },
      }),
    toResult: (r, viewer, terms) => ({
      type: "event",
      id: r.id,
      title: r.title,
      description: describe([r.description, r.location], terms),
      meta: joinMeta(toIsoDate(r.startsAt), r.location),
      href: `/events/${r.id}`,
      ...visibilityField(viewer, r.visibility),
    }),
  }),

  // Knowledge documents (Phase 22): own `visibility` column, so the SAME visibleTo() as news/events. The body is
  // searched too (plain `contains`, bounded by the 20,000-character body cap) and Japanese title/body overrides match
  // through the same translationMatchIds() as every other translatable entity. Linked project/area/group are never
  // searched or returned as columns (only as Phase 20 `related` links, read through visibleTo), so a hidden project
  // can't surface from a document. `meta` is empty: the type badge already says "Knowledge" and a category label
  // would put English words into a Japanese result.
  defineSource<Prisma.KnowledgeDocWhereInput, { id: string; title: string; body: string; visibility: string }>({
    type: "knowledge",
    title: "title",
    fields: ["body"],
    translatable: "KNOWLEDGE_DOC",
    base: visibleTo,
    count: (where) => prisma.knowledgeDoc.count({ where }),
    find: (where, skip, take) =>
      prisma.knowledgeDoc.findMany({
        where,
        skip,
        take,
        orderBy: [{ title: "asc" }, { id: "asc" }],
        select: { id: true, title: true, body: true, visibility: true },
      }),
    toResult: (r, viewer, terms) => ({
      type: "knowledge",
      id: r.id,
      title: r.title,
      description: describe([r.body], terms),
      meta: "",
      href: `/knowledge/${r.id}`,
      ...visibilityField(viewer, r.visibility),
    }),
  }),

  // Lab resources (Phase 23): own `visibility` column, so the SAME visibleTo() as news/events/knowledge. Searched columns are the
  // name, description, type code, vendor, identifier, version and environment notes (plain `contains`; the Japanese name/description/
  // environment overrides match through the same translationMatchIds()). Linked projects/areas/groups/documents are never
  // searched or returned as columns (only as Phase 20 `related` links, read through visibleTo), so a hidden project can't surface
  // from a resource. `meta` is language-neutral (version and vendor as typed, no English label) so a Japanese result has no English words.
  defineSource<Prisma.LabResourceWhereInput, { id: string; name: string; description: string; version: string; vendor: string; visibility: string }>({
    type: "resource",
    title: "name",
    fields: ["description", "resourceType", "vendor", "identifier", "version", "environment"],
    translatable: "LAB_RESOURCE",
    base: visibleTo,
    count: (where) => prisma.labResource.count({ where }),
    find: (where, skip, take) =>
      prisma.labResource.findMany({
        where,
        skip,
        take,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, description: true, version: true, vendor: true, visibility: true },
      }),
    toResult: (r, viewer, terms) => ({
      type: "resource",
      id: r.id,
      title: r.name,
      description: describe([r.description], terms),
      meta: joinMeta(r.version, r.vendor),
      href: `/resources/${r.id}`,
      ...visibilityField(viewer, r.visibility),
    }),
  }),
];

// Sources are listed in SEARCH_TYPES order: that order IS the "type" step of the sort above.
if (sources.some((s, i) => s.type !== SEARCH_TYPES[i])) throw new Error("search sources must follow SEARCH_TYPES order");

// ---- the query ------------------------------------------------------------------------------
/**
 * Runs a search for `viewer`. Cost: one COUNT per type (the numbers on the filter chips), two more
 * COUNTs per selected type that has matches (tier sizes), then only the SELECTs for the tier/type
 * buckets that overlap the requested page. Nothing is loaded that is not returned.
 */
export async function runSearch(viewer: Viewer, query: SearchQuery, locale: Locale = DEFAULT_LOCALE): Promise<SearchResponse> {
  const { type, page, limit } = query;
  const plans = await Promise.all(sources.map(async (s) => ({ type: s.type, plan: await s.plan(viewer, query, locale) })));

  const totals = await Promise.all(plans.map((p) => p.plan.count("all")));
  const selected = plans.map((p, i) => ({ ...p, total: totals[i] })).filter((p) => type === "all" || p.type === type);

  const sizes = await Promise.all(
    selected.map(async (p): Promise<[number, number, number]> => {
      if (p.total === 0) return [0, 0, 0];
      const [t0, t1] = await Promise.all([p.plan.count("t0"), p.plan.count("t1")]);
      return [t0, t1, p.total - t0 - t1];
    }),
  );

  // Buckets in final sort order: tier first, then type. Each bucket is already sorted inside.
  const buckets = TIERS.flatMap((tier, t) => selected.map((p, i) => ({ tier, plan: p.plan, size: sizes[i][t] })));

  const offset = (page - 1) * limit;
  const end = offset + limit;
  const fetches: Promise<SearchResult[]>[] = [];
  let cursor = 0;
  for (const b of buckets) {
    const start = cursor;
    cursor += b.size;
    if (b.size === 0 || cursor <= offset || start >= end) continue;
    const skip = Math.max(0, offset - start);
    fetches.push(b.plan.rows(b.tier, skip, Math.min(b.size, end - start) - skip));
  }
  const results = await attachRelated((await Promise.all(fetches)).flat(), viewer, locale);

  const total = selected.reduce((sum, p) => sum + p.total, 0);
  const counts = { all: totals.reduce((a, b) => a + b, 0) } as SearchResponse["counts"];
  plans.forEach((p, i) => (counts[p.type] = totals[i]));

  return {
    query: query.phrase,
    type,
    results,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    counts,
  };
}

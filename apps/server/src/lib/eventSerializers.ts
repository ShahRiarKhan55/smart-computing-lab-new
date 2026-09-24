import type { Prisma } from "@prisma/client";
import { canDeleteEvent, canEditEvent, eventKindSchema, toUtcMidnight, type EventScope, type LabEvent, type Locale } from "@scl/shared";
import { prisma } from "./prisma.js";
import { canView, visibilityField, type Viewer } from "./visibility.js";
import { loadTranslations, localize } from "./translations.js";

/** What every event read needs: the linked project (for its title/visibility) and the creator's public team profile. */
export const eventInclude = {
  project: { select: { id: true, title: true, visibility: true } },
  createdBy: { select: { teamMember: { select: { id: true, name: true } } } },
} satisfies Prisma.EventInclude;

export type EventRow = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Prisma `where` for the list scope. "Over" means the end instant (end, else start; plus a whole day
 * for an all-day event) is before `now` — the same rule as `isEventPast` in @scl/shared. `upcoming` and
 * `past` are written out as exact complements (gte / lt on the same expression) rather than NOT(...),
 * because SQL's NOT(NULL) drops a row whose `endsAt` is NULL.
 */
export function eventScopeWhere(scope: EventScope, now: Date): Prisma.EventWhereInput {
  if (scope === "all") return {};
  const dayAgo = new Date(now.getTime() - DAY_MS);
  if (scope === "upcoming") {
    return {
      OR: [
        { allDay: false, endsAt: { gte: now } },
        { allDay: false, endsAt: null, startsAt: { gte: now } },
        { allDay: true, endsAt: { gte: dayAgo } },
        { allDay: true, endsAt: null, startsAt: { gte: dayAgo } },
      ],
    };
  }
  return {
    OR: [
      { allDay: false, endsAt: { lt: now } },
      { allDay: false, endsAt: null, startsAt: { lt: now } },
      { allDay: true, endsAt: { lt: dayAgo } },
      { allDay: true, endsAt: null, startsAt: { lt: dayAgo } },
    ],
  };
}

/** Deterministic order: upcoming soonest-first; past/all newest-first. `id` makes it total. */
export const eventOrderBy = (scope: EventScope): Prisma.EventOrderByWithRelationInput[] => [
  { startsAt: scope === "upcoming" ? "asc" : "desc" },
  { id: "asc" },
];

/**
 * Rows -> API shape for this viewer and locale. Two batched translation lookups for the whole list
 * (never one per row). The project is included ONLY when the viewer may see it, so a hidden project's
 * title never rides along on a public event; `locale` selects text only and never affects what is shown.
 */
export async function serializeEvents(rows: EventRow[], viewer: Viewer, locale: Locale): Promise<LabEvent[]> {
  const visibleProjectIds = rows.flatMap((r) => (r.project && canView(viewer, r.project.visibility) ? [r.project.id] : []));
  const [eventTr, projectTr] = await Promise.all([
    loadTranslations(prisma, "EVENT", rows.map((r) => r.id), locale),
    loadTranslations(prisma, "RESEARCH_PROJECT", Array.from(new Set(visibleProjectIds)), locale),
  ]);

  return rows.map((raw) => {
    const row = localize(raw, "EVENT", eventTr);
    const isOwner = viewer !== null && row.createdById === viewer.id;
    const project =
      row.project && canView(viewer, row.project.visibility)
        ? { id: row.project.id, title: localize(row.project, "RESEARCH_PROJECT", projectTr).title }
        : null;
    const profile = row.createdBy?.teamMember ?? null;
    const kind = eventKindSchema.safeParse(row.kind);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      location: row.location,
      url: row.url,
      kind: kind.success ? kind.data : "OTHER",
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      allDay: row.allDay,
      project,
      organizer: profile ? { id: profile.id, name: profile.name } : null,
      canEdit: canEditEvent(viewer, isOwner),
      canDelete: canDeleteEvent(viewer, isOwner),
      ...visibilityField(viewer, row.visibility),
    };
  });
}

/** All-day events are stored as UTC midnight of their calendar day; timed events are kept as given. */
export function normalizeEventTimes(t: { startsAt: Date; endsAt: Date | null; allDay: boolean }) {
  if (!t.allDay) return t;
  return { ...t, startsAt: toUtcMidnight(t.startsAt), endsAt: t.endsAt ? toUtcMidnight(t.endsAt) : null };
}

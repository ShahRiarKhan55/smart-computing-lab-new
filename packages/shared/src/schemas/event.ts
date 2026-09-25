import { z } from "zod";
import { idSchema, optionalHttpUrl, optionalText, requiredText } from "./common.js";
import { visibilitySchema } from "./enums.js";
import { translationsField } from "./translations.js";

/**
 * Phase 16 events, built on the Phase 8 `Event` table exactly as it was designed (no migration):
 * title/description/location/url/kind/startsAt/endsAt/allDay/visibility/projectId/createdById.
 * Registration/RSVP, reminders and calendar sync are deliberately out of scope.
 */

/** The `Event.kind` values the schema documents. `kind` is a plain string column, so this list is the allow-list. */
export const EVENT_KINDS = ["SEMINAR", "MEETING", "DEADLINE", "SOCIAL", "OTHER"] as const;
export const eventKindSchema = z.enum(EVENT_KINDS, {
  errorMap: () => ({ message: "Event type must be one of SEMINAR, MEETING, DEADLINE, SOCIAL or OTHER." }),
});
export type EventKind = z.infer<typeof eventKindSchema>;

/** `GET /api/events?scope=`: upcoming = not yet over (in progress counts), past = over, all = both. */
export const EVENT_SCOPES = ["upcoming", "past", "all"] as const;
export type EventScope = (typeof EVENT_SCOPES)[number];

export const EVENT_LIST_DEFAULT_LIMIT = 100;
export const EVENT_LIST_MAX_LIMIT = 200;

/** Mirrors the English field lengths below — see i18n/translatableFields.ts (EVENT). */
export const EVENT_TRANSLATION_MAX = { title: 200, description: 5000 };

export const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  location: z.string(),
  url: z.string(),
  kind: eventKindSchema,
  /** ISO 8601 UTC instant. For an all-day event: midnight UTC of the event's first calendar day. */
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  allDay: z.boolean(),
  /** The linked project, only when THIS viewer may see that project (never a hidden project's title). */
  project: z.object({ id: z.string(), title: z.string() }).nullable(),
  /** The creator's public team profile, when they have one. Never an account id or email. */
  organizer: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Server-computed with the central policy (owner or manager); cosmetic for the UI, re-checked on every write. */
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility: visibilitySchema.optional(),
});
/**
 * The API shape, written out as an interface (not `z.infer`) because the web tsconfig is not strict and
 * would make every inferred field optional. `eventSchema` above documents the contract; the server's
 * serializer (strict mode) returns this interface, so a drift there fails to compile.
 */
export interface LabEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  url: string;
  kind: EventKind;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  project: { id: string; title: string } | null;
  organizer: { id: string; name: string } | null;
  canEdit: boolean;
  canDelete: boolean;
  visibility?: z.infer<typeof visibilitySchema>;
}

/** `z.array(eventSchema)` typed as the explicit `LabEvent[]` interface, for embedding in other response schemas without the non-strict web build making every field optional. */
export const labEventListSchema = z.array(eventSchema) as unknown as z.ZodType<LabEvent[]>;

// ---- date/time helpers (pure; shared by API, UI and tests) -----------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TIME = Date.UTC(1970, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

/** Parses an ISO instant; `null` for anything not a real date in a sane range (1970..2099). */
export function parseEventInstant(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second = 0, offH = 0, offM = 0] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x))) as number[];
  // Date.parse() rolls "Feb 30" over to "Mar 2", so check the calendar and clock parts ourselves.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59 || second > 59 || offH > 23 || offM > 59) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || ms < MIN_TIME || ms >= MAX_TIME) return null;
  return new Date(ms);
}

/** The last moment an event occupies: end (or start), plus one whole day for an all-day event. */
export function eventEndInstant(e: { startsAt: string | Date; endsAt: string | Date | null; allDay: boolean }): number {
  const base = new Date(e.endsAt ?? e.startsAt).getTime();
  return e.allDay ? base + DAY_MS : base;
}

/** Past = already over at `now`. An event in progress is NOT past. */
export function isEventPast(e: { startsAt: string | Date; endsAt: string | Date | null; allDay: boolean }, now: number = Date.now()): boolean {
  return eventEndInstant(e) < now;
}

/** All-day events are stored as UTC midnight of their calendar day. */
export function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const instantField = (label: string) =>
  z
    .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be a date and time.` })
    .trim()
    .refine((v) => parseEventInstant(v) !== null, `${label} must be a valid date and time.`);

/** null/"" clear the end (a one-moment event). */
const endField = z
  .union([instantField("End"), z.literal(""), z.null()], { invalid_type_error: "End must be a date and time." })
  .transform((v) => (v === "" ? null : v));

const RANGE_MESSAGE = "End can't be before the start.";

/** True when both instants exist and the end precedes the start. */
export function eventRangeInvalid(startsAt: string | Date | null | undefined, endsAt: string | Date | null | undefined): boolean {
  if (!startsAt || !endsAt) return false;
  return new Date(endsAt).getTime() < new Date(startsAt).getTime();
}

const eventFields = {
  title: requiredText("Title", 200),
  description: optionalText("Description", 5000),
  location: optionalText("Location", 200),
  url: optionalHttpUrl("Link"),
  kind: eventKindSchema,
  startsAt: instantField("Start"),
  endsAt: endField,
  allDay: z.boolean({ invalid_type_error: "All-day must be true or false." }),
  visibility: visibilitySchema,
  projectId: idSchema.nullable(),
  translations: translationsField(EVENT_TRANSLATION_MAX),
};

const rangeRule = (v: { startsAt?: string; endsAt?: string | null }) => !eventRangeInvalid(v.startsAt, v.endsAt);

export const createEventSchema = z
  .object({
    title: eventFields.title,
    description: eventFields.description.optional().default(""),
    location: eventFields.location.optional().default(""),
    url: eventFields.url.optional().default(""),
    kind: eventFields.kind.optional().default("OTHER"),
    startsAt: eventFields.startsAt,
    endsAt: eventFields.endsAt.optional(),
    allDay: eventFields.allDay.optional().default(false),
    /** Lab managers and admins only (403 for anyone else); omitted = LAB_ONLY, the table's default. */
    visibility: eventFields.visibility.optional(),
    /** Lab managers and admins only. */
    projectId: eventFields.projectId.optional(),
    /** Japanese title/description override (Phase 14); see translations.ts. */
    translations: eventFields.translations,
  })
  .refine(rangeRule, { message: RANGE_MESSAGE, path: ["endsAt"] });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z
  .object({
    title: eventFields.title.optional(),
    description: eventFields.description.optional(),
    location: eventFields.location.optional(),
    url: eventFields.url.optional(),
    kind: eventFields.kind.optional(),
    startsAt: eventFields.startsAt.optional(),
    endsAt: eventFields.endsAt.optional(),
    allDay: eventFields.allDay.optional(),
    visibility: eventFields.visibility.optional(),
    projectId: eventFields.projectId.optional(),
    translations: eventFields.translations,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.")
  .refine(rangeRule, { message: RANGE_MESSAGE, path: ["endsAt"] });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/** GET /api/events query string. */
export const eventListQuerySchema = z.object({
  scope: z
    .enum(EVENT_SCOPES, { errorMap: () => ({ message: `Scope must be one of: ${EVENT_SCOPES.join(", ")}.` }) })
    .optional()
    .default("upcoming"),
  limit: z
    .string({ invalid_type_error: "Limit must be a whole number." })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return EVENT_LIST_DEFAULT_LIMIT;
      if (!/^\d{1,4}$/.test(v) || Number(v) < 1 || Number(v) > EVENT_LIST_MAX_LIMIT) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Limit must be a whole number between 1 and ${EVENT_LIST_MAX_LIMIT}.` });
        return z.NEVER;
      }
      return Number(v);
    }),
  page: z
    .string({ invalid_type_error: "Page must be a whole number." })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return 1;
      if (!/^\d{1,5}$/.test(v) || Number(v) < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Page must be a whole number of at least 1." });
        return z.NEVER;
      }
      return Number(v);
    }),
});
export type EventListQuery = z.infer<typeof eventListQuerySchema>;

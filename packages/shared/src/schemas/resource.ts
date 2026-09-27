import { z } from "zod";
import { idSchema, isHttpUrl, optionalHttpUrl, optionalText, requiredText } from "./common.js";
import { visibilitySchema, type Visibility } from "./enums.js";
import { parseSearchText, SEARCH_MAX_TERMS, SEARCH_QUERY_MAX_LENGTH } from "./search.js";
import { translationsField } from "./translations.js";

/**
 * Phase 23 lab resources & reproducibility, built on the Phase 23 `LabResource` / `ResourceProject` tables.
 * A resource is a structured record of research infrastructure (a dataset, a board, a tool ...) that a piece
 * of research needs. It is NOT a file manager or an inventory: it holds no file, no stock, no cost. Long-form
 * documentation stays in Phase 22 knowledge documents (`knowledgeDocId`). Every text field is plain text.
 */

// ---- types ----------------------------------------------------------------------------------
/** The `LabResource.resourceType` values. The column is a plain string, so this list is the allow-list. */
export const RESOURCE_TYPES = [
  "DATASET",
  "HARDWARE",
  "SOFTWARE",
  "TOOL",
  "FRAMEWORK",
  "MODEL",
  "FPGA",
  "BOARD",
  "SENSOR",
  "MEASUREMENT_SETUP",
  "EXPERIMENT_ENVIRONMENT",
  "OTHER",
] as const;
export const resourceTypeSchema = z.enum(RESOURCE_TYPES, {
  errorMap: () => ({ message: `Type must be one of: ${RESOURCE_TYPES.join(", ")}.` }),
});
export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  DATASET: "Dataset",
  HARDWARE: "Hardware",
  SOFTWARE: "Software",
  TOOL: "Tool",
  FRAMEWORK: "Framework",
  MODEL: "Model",
  FPGA: "FPGA",
  BOARD: "Board",
  SENSOR: "Sensor",
  MEASUREMENT_SETUP: "Measurement setup",
  EXPERIMENT_ENVIRONMENT: "Experiment environment",
  OTHER: "Other",
};

/** How the reproducibility panel groups types: "what hardware, software and data does this need?" */
export const RESOURCE_FAMILIES = ["HARDWARE", "SOFTWARE", "DATA", "ENVIRONMENT"] as const;
export type ResourceFamily = (typeof RESOURCE_FAMILIES)[number];
export const RESOURCE_TYPE_FAMILY: Record<ResourceType, ResourceFamily> = {
  HARDWARE: "HARDWARE",
  FPGA: "HARDWARE",
  BOARD: "HARDWARE",
  SENSOR: "HARDWARE",
  MEASUREMENT_SETUP: "HARDWARE",
  SOFTWARE: "SOFTWARE",
  TOOL: "SOFTWARE",
  FRAMEWORK: "SOFTWARE",
  MODEL: "SOFTWARE",
  DATASET: "DATA",
  EXPERIMENT_ENVIRONMENT: "ENVIRONMENT",
  OTHER: "ENVIRONMENT",
};
/** A stored value outside the allow-list is shown as OTHER rather than trusted. */
export const asResourceType = (v: string): ResourceType => (resourceTypeSchema.safeParse(v).success ? (v as ResourceType) : "OTHER");

// ---- structured reproducibility metadata --------------------------------------------------------
/** Which metadata keys each type may carry (the JSON column is validated against this allow-list). */
export const RESOURCE_METADATA_KEYS = [
  "format",
  "size",
  "license",
  "collectionMethod",
  "hardwareRevision",
  "firmwareVersion",
  "toolchain",
  "platform",
  "configuration",
  "requirements",
  "measurementConditions",
] as const;
export type ResourceMetadataKey = (typeof RESOURCE_METADATA_KEYS)[number];

const HW = ["hardwareRevision", "firmwareVersion", "toolchain"] as const;
const SW = ["platform", "configuration", "requirements"] as const;
export const RESOURCE_TYPE_METADATA: Record<ResourceType, readonly ResourceMetadataKey[]> = {
  DATASET: ["format", "size", "license", "collectionMethod"],
  HARDWARE: HW,
  FPGA: HW,
  BOARD: HW,
  SENSOR: HW,
  SOFTWARE: SW,
  TOOL: SW,
  FRAMEWORK: SW,
  MODEL: ["format", "license", "requirements"],
  MEASUREMENT_SETUP: ["measurementConditions", "configuration"],
  EXPERIMENT_ENVIRONMENT: SW,
  OTHER: [],
};
export const RESOURCE_METADATA_VALUE_MAX = 500;
export type ResourceMetadata = Partial<Record<ResourceMetadataKey, string>>;

/** The metadata of a stored JSON string: only allow-listed keys with non-empty text values; anything else (bad JSON, arrays, a tampered row) reads as none. */
export function parseResourceMetadata(raw: string | null | undefined, type: ResourceType): ResourceMetadata {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const allowed = RESOURCE_TYPE_METADATA[type];
  const out: ResourceMetadata = {};
  for (const key of allowed) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v.slice(0, RESOURCE_METADATA_VALUE_MAX);
  }
  return out;
}

/** An error message when `metadata` carries a key this type may not have, else null. */
export function resourceMetadataError(type: ResourceType, metadata: Record<string, string>): string | null {
  const allowed = RESOURCE_TYPE_METADATA[type] as readonly string[];
  const bad = Object.keys(metadata).filter((k) => !allowed.includes(k));
  if (bad.length === 0) return null;
  return `Metadata ${bad.join(", ")} doesn't apply to ${type}${allowed.length > 0 ? ` (allowed: ${allowed.join(", ")})` : ""}.`;
}

// ---- limits -----------------------------------------------------------------------------------------
export const RESOURCE_NAME_MAX = 200;
export const RESOURCE_DESCRIPTION_MAX = 5000;
export const RESOURCE_SHORT_MAX = 200; // version, vendor, identifier
export const RESOURCE_ENVIRONMENT_MAX = 5000;
export const RESOURCE_PROJECTS_MAX = 50;
/** Mirrors the English field lengths — see i18n/translatableFields.ts (LAB_RESOURCE). */
export const RESOURCE_TRANSLATION_MAX = { name: RESOURCE_NAME_MAX, description: RESOURCE_DESCRIPTION_MAX, environment: RESOURCE_ENVIRONMENT_MAX };

export const RESOURCE_LIST_DEFAULT_LIMIT = 12;
export const RESOURCE_LIST_MAX_LIMIT = 50;
/** How many resources a research page / the workspace shows before it links to the full list. */
export const RESOURCE_SECTION_LIMIT = 5;
/** The project page's reproducibility panel shows more (it groups them), still bounded. */
export const RESOURCE_PANEL_LIMIT = 12;
/** A list card names at most this many projects (plus a count); the detail page names them all. */
export const RESOURCE_CARD_PROJECTS = 3;
export const RESOURCE_EXCERPT_LENGTH = 200;

/** A short plain-text excerpt of a description (list cards; never HTML). */
export function resourceExcerpt(text: string, max: number = RESOURCE_EXCERPT_LENGTH): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`;
}

/** The link shown for a resource: only ever an http(s) URL, whatever the column holds. */
export const safeResourceUrl = (v: string): string => (isHttpUrl(v) ? v : "");

// ---- response shapes (interfaces: the web tsconfig is not strict) -----------------------------------
/** A related project / area / group / document / publication / event, present ONLY when the viewer may see it. */
export interface ResourceRef {
  id: string;
  title: string;
}
/** A public team profile reference. Never an account id or e-mail. */
export interface ResourcePerson {
  id: string;
  name: string;
}
export interface ResourceSummary {
  id: string;
  name: string;
  resourceType: ResourceType;
  version: string;
  vendor: string;
  identifier: string;
  /** Always an http(s) URL or "". */
  url: string;
  excerpt: string;
  /** The owner's public team profile, or null (no profile / account deleted). */
  owner: ResourcePerson | null;
  researcher: ResourcePerson | null;
  /** At most RESOURCE_CARD_PROJECTS visible projects; `projectCount` is every visible one. */
  projects: ResourceRef[];
  projectCount: number;
  researchArea: ResourceRef | null;
  group: ResourceRef | null;
  createdAt: string;
  updatedAt: string;
  /** Server-computed with the central policy (owner or manager); cosmetic for the UI, re-checked on every write. */
  canEdit: boolean;
  canDelete: boolean;
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility?: Visibility;
}
export interface ResourceDetail extends ResourceSummary {
  /** Plain text. The UI renders it as text (line breaks kept), never as HTML. */
  description: string;
  /** Reproducibility notes / configuration, plain text. */
  environment: string;
  metadata: ResourceMetadata;
  knowledgeDoc: ResourceRef | null;
  publication: ResourceRef | null;
  event: ResourceRef | null;
}
export interface ResourceListResponse {
  items: ResourceSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
/** A capped list on a research page / the workspace: `total` is everything the viewer may see. */
export interface ResourceSection {
  items: ResourceSummary[];
  total: number;
}

// ---- requests ---------------------------------------------------------------------------------------
const nullableId = idSchema.nullable();

const fields = {
  name: requiredText("Name", RESOURCE_NAME_MAX),
  description: optionalText("Description", RESOURCE_DESCRIPTION_MAX),
  version: optionalText("Version", RESOURCE_SHORT_MAX),
  vendor: optionalText("Vendor", RESOURCE_SHORT_MAX),
  identifier: optionalText("Identifier", RESOURCE_SHORT_MAX),
  url: optionalHttpUrl("Link"),
  environment: optionalText("Environment notes", RESOURCE_ENVIRONMENT_MAX),
  resourceType: resourceTypeSchema,
  visibility: visibilitySchema,
  translations: translationsField(RESOURCE_TRANSLATION_MAX),
};

/** `{key: text}`; every value trimmed, empty values dropped, unknown keys are checked against the type later (`resourceMetadataError`). */
const metadataField = z
  .record(
    z.string().max(40),
    z.string({ invalid_type_error: "Metadata values must be text." }).max(RESOURCE_METADATA_VALUE_MAX, `Metadata values must be at most ${RESOURCE_METADATA_VALUE_MAX} characters.`),
    { invalid_type_error: "Metadata must be an object." },
  )
  .transform((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== "")) as Record<string, string>);

const projectIdsField = z
  .array(idSchema, { invalid_type_error: "projectIds must be an array of project ids." })
  .max(RESOURCE_PROJECTS_MAX, `A resource can be linked to at most ${RESOURCE_PROJECTS_MAX} projects.`)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate projects.");

export const createResourceSchema = z
  .object({
    name: fields.name,
    resourceType: fields.resourceType.optional().default("OTHER"),
    description: fields.description.optional().default(""),
    version: fields.version.optional().default(""),
    vendor: fields.vendor.optional().default(""),
    identifier: fields.identifier.optional().default(""),
    url: fields.url.optional().default(""),
    environment: fields.environment.optional().default(""),
    metadata: metadataField.optional(),
    /** Lab managers and admins only (403 for anyone else); omitted = LAB_ONLY, the table's default. */
    visibility: fields.visibility.optional(),
    projectIds: projectIdsField.optional(),
    researchAreaId: nullableId.optional(),
    groupId: nullableId.optional(),
    knowledgeDocId: nullableId.optional(),
    publicationId: nullableId.optional(),
    eventId: nullableId.optional(),
    teamMemberId: nullableId.optional(),
    /** Japanese name/description/environment override (Phase 14); see translations.ts. */
    translations: fields.translations,
  })
  .superRefine((v, ctx) => {
    const err = v.metadata ? resourceMetadataError(v.resourceType, v.metadata) : null;
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err, path: ["metadata"] });
  });
export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export const updateResourceSchema = z
  .object({
    name: fields.name.optional(),
    resourceType: fields.resourceType.optional(),
    description: fields.description.optional(),
    version: fields.version.optional(),
    vendor: fields.vendor.optional(),
    identifier: fields.identifier.optional(),
    url: fields.url.optional(),
    environment: fields.environment.optional(),
    metadata: metadataField.optional(),
    visibility: fields.visibility.optional(),
    projectIds: projectIdsField.optional(),
    researchAreaId: nullableId.optional(),
    groupId: nullableId.optional(),
    knowledgeDocId: nullableId.optional(),
    publicationId: nullableId.optional(),
    eventId: nullableId.optional(),
    teamMemberId: nullableId.optional(),
    translations: fields.translations,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.")
  .superRefine((v, ctx) => {
    // Both present: check now. Only one present: the route checks against the stored type / metadata.
    const err = v.metadata && v.resourceType ? resourceMetadataError(v.resourceType, v.metadata) : null;
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err, path: ["metadata"] });
  });
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

/** A query-string whole number within [min, max]; absent means `fallback`. */
function intParam(label: string, min: number, max: number, fallback: number) {
  const message = `${label} must be a whole number between ${min} and ${max}.`;
  return z
    .string({ invalid_type_error: message })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return fallback;
      if (!/^\d{1,7}$/.test(v) || Number(v) < min || Number(v) > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return Number(v);
    });
}

/** An optional id filter: absent or "" means "no filter"; anything that is not an id is a 400. */
const idParam = (label: string) =>
  z
    .string({ invalid_type_error: `${label} must be an id.` })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      if (!idSchema.safeParse(v).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid id." });
        return z.NEVER;
      }
      return v;
    });

/** GET /api/resources query string. */
export const resourceListQuerySchema = z.object({
  q: z
    .string({ invalid_type_error: "Search text must be text." })
    .max(SEARCH_QUERY_MAX_LENGTH, `Search text must be at most ${SEARCH_QUERY_MAX_LENGTH} characters.`)
    .optional()
    .transform((v, ctx) => {
      const parsed = parseSearchText((v ?? "").trim());
      if (parsed.terms.length > SEARCH_MAX_TERMS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Search text can have at most ${SEARCH_MAX_TERMS} words.` });
        return z.NEVER;
      }
      return parsed;
    }),
  type: z
    .string({ invalid_type_error: "Type must be text." })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      const r = resourceTypeSchema.safeParse(v);
      if (!r.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error.issues[0].message });
        return z.NEVER;
      }
      return r.data;
    }),
  project: idParam("Project"),
  area: idParam("Research area"),
  group: idParam("Group"),
  researcher: idParam("Researcher"),
  knowledge: idParam("Document"),
  publication: idParam("Publication"),
  /** Lab managers and admins only (403 for anyone else). */
  visibility: z
    .string({ invalid_type_error: "Visibility must be PUBLIC or LAB_ONLY." })
    .optional()
    .transform((v, ctx): Visibility | undefined => {
      if (v === undefined || v === "") return undefined;
      const r = visibilitySchema.safeParse(v);
      if (!r.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error.issues[0].message });
        return z.NEVER;
      }
      return r.data;
    }),
  /** "1": only resources related to the signed-in researcher (the workspace's own definition). Signed-in only. */
  mine: z
    .string({ invalid_type_error: "Mine must be 1." })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return false;
      if (v !== "1") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Mine must be 1." });
        return z.NEVER;
      }
      return true;
    }),
  page: intParam("Page", 1, 10000, 1),
  limit: intParam("Limit", 1, RESOURCE_LIST_MAX_LIMIT, RESOURCE_LIST_DEFAULT_LIMIT),
});
export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>;

/**
 * Unit test of the pure parts of lab resources & reproducibility (Phase 23): the shared request/query
 * schemas, the type / metadata allow-lists, the central permission functions, the serializer's visibility
 * behaviour (English path, against plain rows), the where-builders, metadata storage, the admin / search /
 * translation registrations and the i18n dictionaries. No server, no database.   npm run test:unit -w apps/server
 */
import {
  ADMIN_CONTENT_TYPES,
  ADMIN_TRANSLATION_ENTITY,
  ADMIN_TRANSLATION_MAX,
  RESOURCE_CARD_PROJECTS,
  RESOURCE_DESCRIPTION_MAX,
  RESOURCE_ENVIRONMENT_MAX,
  RESOURCE_FAMILIES,
  RESOURCE_LIST_DEFAULT_LIMIT,
  RESOURCE_LIST_MAX_LIMIT,
  RESOURCE_METADATA_KEYS,
  RESOURCE_METADATA_VALUE_MAX,
  RESOURCE_NAME_MAX,
  RESOURCE_PANEL_LIMIT,
  RESOURCE_PROJECTS_MAX,
  RESOURCE_SECTION_LIMIT,
  RESOURCE_TRANSLATION_MAX,
  RESOURCE_TYPES,
  RESOURCE_TYPE_FAMILY,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPE_METADATA,
  SEARCH_TYPES,
  TRANSLATABLE_FIELDS,
  WORKSPACE_LIMITS,
  adminContentQuerySchema,
  asResourceType,
  canCreateResource,
  canDeleteResource,
  canEditResource,
  canFilterResourcesByVisibility,
  createResourceSchema,
  en,
  hasVisibility,
  isHttpUrl,
  ja,
  parseResourceMetadata,
  resourceExcerpt,
  resourceListQuerySchema,
  resourceMetadataError,
  safeResourceUrl,
  updateResourceSchema,
} from "@scl/shared";
import { metadataToStored, resourceInclude, resourceOrderBy, resourceScope, resourceWhere, serializeResources, type ResourceRow } from "../src/lib/resources.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

const valid = (over: Record<string, unknown> = {}) => createResourceSchema.safeParse({ name: "Vivado", ...over });
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? "" : (r.error?.issues[0]?.message ?? ""));

// ---- resource types ---------------------------------------------------------------------------
t("twelve types, the documented ones, in order", RESOURCE_TYPES.join() === "DATASET,HARDWARE,SOFTWARE,TOOL,FRAMEWORK,MODEL,FPGA,BOARD,SENSOR,MEASUREMENT_SETUP,EXPERIMENT_ENVIRONMENT,OTHER");
t("every type has an English label, a family and a metadata list", RESOURCE_TYPES.every((x) => RESOURCE_TYPE_LABELS[x].length > 0 && RESOURCE_FAMILIES.includes(RESOURCE_TYPE_FAMILY[x]) && Array.isArray(RESOURCE_TYPE_METADATA[x])) && Object.keys(RESOURCE_TYPE_LABELS).length === 12);
t("every type has an en AND a ja UI label, and the ja one is not the English one (except the acronym FPGA)", RESOURCE_TYPES.every((x) => {
  const key = `resource.type.${x}` as keyof typeof en;
  return typeof en[key] === "string" && typeof ja[key] === "string" && ja[key].length > 0 && (x === "FPGA" || ja[key] !== en[key]);
}));
t("every family has an en and a ja heading", RESOURCE_FAMILIES.every((f) => typeof (en as Record<string, string>)[`resource.family.${f}`] === "string" && /[　-ヿ一-鿿]/.test((ja as Record<string, string>)[`resource.family.${f}`])));
t("families: hardware types, software types, data and environment", RESOURCE_TYPE_FAMILY.FPGA === "HARDWARE" && RESOURCE_TYPE_FAMILY.SENSOR === "HARDWARE" && RESOURCE_TYPE_FAMILY.FRAMEWORK === "SOFTWARE" && RESOURCE_TYPE_FAMILY.MODEL === "SOFTWARE" && RESOURCE_TYPE_FAMILY.DATASET === "DATA" && RESOURCE_TYPE_FAMILY.OTHER === "ENVIRONMENT");
t("asResourceType: a stored value outside the allow-list reads as OTHER", asResourceType("DATASET") === "DATASET" && asResourceType("dataset") === "OTHER" && asResourceType("") === "OTHER" && asResourceType("<script>") === "OTHER");

// ---- metadata allow-list --------------------------------------------------------------------------
t("every metadata key of every type is a known key, and every key is used by some type", Object.values(RESOURCE_TYPE_METADATA).every((ks) => ks.every((k) => RESOURCE_METADATA_KEYS.includes(k))) && RESOURCE_METADATA_KEYS.every((k) => Object.values(RESOURCE_TYPE_METADATA).some((ks) => ks.includes(k))));
t("every metadata key has an en and a ja label", RESOURCE_METADATA_KEYS.every((k) => typeof (en as Record<string, string>)[`resource.meta.${k}`] === "string" && /[　-ヿ一-鿿]/.test((ja as Record<string, string>)[`resource.meta.${k}`])));
t("datasets carry format/size/license/collection method; hardware revision/firmware/toolchain; OTHER nothing", RESOURCE_TYPE_METADATA.DATASET.join() === "format,size,license,collectionMethod" && RESOURCE_TYPE_METADATA.FPGA.join() === "hardwareRevision,firmwareVersion,toolchain" && RESOURCE_TYPE_METADATA.OTHER.length === 0 && RESOURCE_TYPE_METADATA.MEASUREMENT_SETUP.includes("measurementConditions"));
t("resourceMetadataError: null when every key fits, names the offending keys otherwise", resourceMetadataError("DATASET", { format: "CSV" }) === null && resourceMetadataError("DATASET", {}) === null && (resourceMetadataError("DATASET", { firmwareVersion: "1", evil: "x" }) ?? "").includes("firmwareVersion, evil") && (resourceMetadataError("OTHER", { format: "x" }) ?? "").includes("OTHER"));
t("parseResourceMetadata: only allow-listed non-empty text values of the type", JSON.stringify(parseResourceMetadata('{"format":"CSV","evil":"x","size":"  ","license":5}', "DATASET")) === '{"format":"CSV"}');
t("parseResourceMetadata: bad JSON, arrays, null, strings and missing all read as none", ["{not json", "[1]", "null", '"x"', "", null, undefined, "5"].every((v) => Object.keys(parseResourceMetadata(v as string, "DATASET")).length === 0));
t("parseResourceMetadata: a value longer than the cap is cut, and a key of another type is dropped", parseResourceMetadata(JSON.stringify({ format: "x".repeat(900) }), "DATASET").format?.length === RESOURCE_METADATA_VALUE_MAX && !("firmwareVersion" in parseResourceMetadata('{"firmwareVersion":"1"}', "DATASET")));
t("metadataToStored: allow-listed keys in the type's order, null when empty", metadataToStored("DATASET", { size: "2 GB", format: "CSV", evil: "x" }) === '{"format":"CSV","size":"2 GB"}' && metadataToStored("DATASET", {}) === null && metadataToStored("OTHER", { format: "x" }) === null);

// ---- create schema --------------------------------------------------------------------------------
const base = valid();
t("create: a name is enough", base.success);
t("create: defaults are type OTHER, empty text, no visibility, no links, no metadata", base.success && base.data.resourceType === "OTHER" && base.data.description === "" && base.data.version === "" && base.data.vendor === "" && base.data.identifier === "" && base.data.url === "" && base.data.environment === "" && base.data.visibility === undefined && base.data.projectIds === undefined && base.data.metadata === undefined && base.data.researchAreaId === undefined && base.data.eventId === undefined);
t("create: text is trimmed", (valid({ name: "  Vivado  ", version: " 2024.1 " }) as { data: { name: string; version: string } }).data.name === "Vivado" && (valid({ version: " 2024.1 " }) as { data: { version: string } }).data.version === "2024.1");
t("create: name is required, blank rejected, message is the allow-listed one", msg(createResourceSchema.safeParse({})) === "Name is required." && !valid({ name: "   " }).success && msg(valid({ name: "" })) === "Name is required.");
t("create: name 200 ok / 201 rejected with the allow-listed message", valid({ name: "x".repeat(RESOURCE_NAME_MAX) }).success && msg(valid({ name: "x".repeat(RESOURCE_NAME_MAX + 1) })) === "Name must be at most 200 characters.");
t("create: description / environment caps", valid({ description: "x".repeat(RESOURCE_DESCRIPTION_MAX) }).success && !valid({ description: "x".repeat(RESOURCE_DESCRIPTION_MAX + 1) }).success && valid({ environment: "x".repeat(RESOURCE_ENVIRONMENT_MAX) }).success && msg(valid({ environment: "x".repeat(RESOURCE_ENVIRONMENT_MAX + 1) })) === "Environment notes must be at most 5000 characters.");
t("create: version / vendor / identifier capped at 200", ["version", "vendor", "identifier"].every((k) => valid({ [k]: "x".repeat(200) }).success && !valid({ [k]: "x".repeat(201) }).success));
t("create: non-string text rejected, not coerced", !valid({ name: 5 }).success && !valid({ description: { a: 1 } }).success && !valid({ version: 1 }).success && !valid({ vendor: [] }).success && !valid({ identifier: true }).success && !valid({ environment: 0 }).success);
t("create: every type accepted", RESOURCE_TYPES.every((x) => valid({ resourceType: x }).success));
t("create: unknown / mis-cased / hostile / non-string type rejected", ["dataset", "Dataset", "ROCKET", "'; DROP TABLE LabResource; --", "<script>alert(1)</script>", "", "DATASET ", 1, null, ["DATASET"], {}].every((x) => !valid({ resourceType: x }).success));
t("create: the type error message is the allow-listed one", msg(valid({ resourceType: "nope" })) === `Type must be one of: ${RESOURCE_TYPES.join(", ")}.`);
t("create: visibility must be PUBLIC or LAB_ONLY", valid({ visibility: "PUBLIC" }).success && valid({ visibility: "LAB_ONLY" }).success && !valid({ visibility: "SECRET" }).success && !valid({ visibility: "PRIVATE" }).success);
t("create: URL must be http(s) or empty", ["", "https://example.com", "http://example.com/a?b=c#d", "HTTPS://EXAMPLE.COM"].every((u) => valid({ url: u }).success) && ["javascript:alert(1)", "data:text/html,x", "ftp://x.y", "//evil.example", "example.com", "not a url", "https://", "http:// x", "vbscript:x", "file:///etc/passwd", " javascript:1"].every((u) => !valid({ url: u }).success));
t("create: URL 2048 chars ok / 2049 rejected, and the message is the allow-listed one", valid({ url: `https://example.com/${"a".repeat(2048 - 20)}` }).success && !valid({ url: `https://example.com/${"a".repeat(2050)}` }).success && msg(valid({ url: "javascript:1" })) === "Link must be a valid URL starting with http:// or https://.");
t("create: a padded URL is trimmed, then checked", (valid({ url: "  https://example.com/a  " }) as { data: { url: string } }).data.url === "https://example.com/a" && !valid({ url: "  javascript:alert(1)  " }).success);
t("create: link ids must look like ids; null is allowed", ["researchAreaId", "groupId", "knowledgeDocId", "publicationId", "eventId", "teamMemberId"].every((k) => valid({ [k]: "abc_123-X" }).success && valid({ [k]: null }).success && !valid({ [k]: "a b" }).success && !valid({ [k]: "../x" }).success && !valid({ [k]: 5 }).success));
t("create: projectIds are ids, unique, at most 50", valid({ projectIds: ["a", "b"] }).success && valid({ projectIds: [] }).success && !valid({ projectIds: ["a", "a"] }).success && !valid({ projectIds: ["a b"] }).success && !valid({ projectIds: "a" }).success && valid({ projectIds: Array.from({ length: RESOURCE_PROJECTS_MAX }, (_, i) => `p${i}`) }).success && !valid({ projectIds: Array.from({ length: RESOURCE_PROJECTS_MAX + 1 }, (_, i) => `p${i}`) }).success);
t("create: metadata keys must fit the type", valid({ resourceType: "DATASET", metadata: { format: "CSV", size: "1 GB" } }).success && !valid({ resourceType: "DATASET", metadata: { firmwareVersion: "1" } }).success && valid({ resourceType: "FPGA", metadata: { firmwareVersion: "1" } }).success && !valid({ resourceType: "OTHER", metadata: { format: "x" } }).success && valid({ resourceType: "OTHER", metadata: {} }).success);
t("create: an unknown / prototype metadata key is rejected", !valid({ resourceType: "DATASET", metadata: { constructor: "x" } }).success && !valid({ resourceType: "DATASET", metadata: JSON.parse('{"__proto__":{"a":"b"}}') }).success && !valid({ resourceType: "DATASET", metadata: { evil: "x" } }).success);
t("create: metadata values are trimmed, blanks dropped, capped, and must be text", (valid({ resourceType: "DATASET", metadata: { format: "  CSV ", size: "  " } }) as { data: { metadata: Record<string, string> } }).data.metadata.format === "CSV" && Object.keys((valid({ resourceType: "DATASET", metadata: { size: "  " } }) as { data: { metadata: Record<string, string> } }).data.metadata).length === 0 && valid({ resourceType: "DATASET", metadata: { format: "x".repeat(RESOURCE_METADATA_VALUE_MAX) } }).success && !valid({ resourceType: "DATASET", metadata: { format: "x".repeat(RESOURCE_METADATA_VALUE_MAX + 1) } }).success && !valid({ resourceType: "DATASET", metadata: { format: 5 } }).success && !valid({ resourceType: "DATASET", metadata: "format=CSV" }).success && !valid({ resourceType: "DATASET", metadata: ["a"] }).success);
t("create: the metadata error names the offending key and points at `metadata`", (() => {
  const r = valid({ resourceType: "DATASET", metadata: { firmwareVersion: "1" } });
  return !r.success && r.error.issues[0].path[0] === "metadata" && r.error.issues[0].message.includes("firmwareVersion");
})());
t("create: unknown keys (ownerId, id, createdAt, role) are stripped, never accepted", (() => {
  const r = valid({ ownerId: "someone", id: "x", createdAt: "2001-01-01", role: "ADMIN" }) as { data: Record<string, unknown> };
  return r.data.ownerId === undefined && r.data.id === undefined && r.data.createdAt === undefined && r.data.role === undefined;
})());
t("create: translations accept ja name/description/environment, null/'' clear, and cap their length", valid({ translations: { ja: { name: "名", description: "説明", environment: "環境" } } }).success && valid({ translations: { ja: { name: null, description: "" } } }).success && !valid({ translations: { ja: { name: "あ".repeat(201) } } }).success && !valid({ translations: { ja: { description: "あ".repeat(5001) } } }).success && !valid({ translations: { ja: { environment: "あ".repeat(5001) } } }).success);
t("create: an unknown translation field is stripped", (() => {
  const r = valid({ translations: { ja: { name: "x", visibility: "PUBLIC", evil: "y" } } }) as { data: { translations: { ja: Record<string, unknown> } } };
  return Object.keys(r.data.translations.ja).join() === "name";
})());
t("RESOURCE_TRANSLATION_MAX mirrors the English caps and the allow-list fields", RESOURCE_TRANSLATION_MAX.name === 200 && RESOURCE_TRANSLATION_MAX.description === 5000 && RESOURCE_TRANSLATION_MAX.environment === 5000 && Object.keys(RESOURCE_TRANSLATION_MAX).join() === TRANSLATABLE_FIELDS.LAB_RESOURCE.join());

// ---- update schema --------------------------------------------------------------------------------
t("update: an empty object is 'Nothing to update.'", msg(updateResourceSchema.safeParse({})) === "Nothing to update.");
t("update: any single field is enough", updateResourceSchema.safeParse({ name: "x" }).success && updateResourceSchema.safeParse({ eventId: null }).success && updateResourceSchema.safeParse({ projectIds: [] }).success && updateResourceSchema.safeParse({ metadata: {} }).success && updateResourceSchema.safeParse({ translations: { ja: { environment: "x" } } }).success);
t("update: fields are validated like create", !updateResourceSchema.safeParse({ name: "" }).success && !updateResourceSchema.safeParse({ url: "javascript:1" }).success && !updateResourceSchema.safeParse({ resourceType: "nope" }).success && !updateResourceSchema.safeParse({ projectIds: ["a", "a"] }).success);
t("update: type + metadata together are checked; a lone metadata is left to the route (it knows the stored type)", !updateResourceSchema.safeParse({ resourceType: "DATASET", metadata: { firmwareVersion: "1" } }).success && updateResourceSchema.safeParse({ resourceType: "FPGA", metadata: { firmwareVersion: "1" } }).success && updateResourceSchema.safeParse({ metadata: { firmwareVersion: "1" } }).success);
t("update: an ownerId / id in the body is stripped and cannot be the 'something' to update", !updateResourceSchema.safeParse({ ownerId: "x" }).success && !updateResourceSchema.safeParse({ id: "x", createdAt: "x" }).success);

// ---- list query ---------------------------------------------------------------------------------------
const q = (o: Record<string, unknown> = {}) => resourceListQuerySchema.safeParse(o);
t("query: defaults are page 1, the default limit, no filters, mine false", (() => {
  const r = q();
  return r.success && r.data.page === 1 && r.data.limit === RESOURCE_LIST_DEFAULT_LIMIT && r.data.mine === false && r.data.type === undefined && r.data.q.terms.length === 0 && r.data.project === undefined;
})());
t("query: type is one of the twelve; junk is rejected; empty means none", RESOURCE_TYPES.every((x) => q({ type: x }).success) && !q({ type: "dataset" }).success && !q({ type: "x" }).success && q({ type: "" }).success && (q({ type: "" }) as { data: { type: unknown } }).data.type === undefined);
t("query: id filters accept ids, ignore '', reject garbage", ["project", "area", "group", "researcher", "knowledge", "publication"].every((k) => q({ [k]: "abc_1-X" }).success && q({ [k]: "" }).success && !q({ [k]: "a b" }).success && !q({ [k]: "<x>" }).success && !q({ [k]: "a;b" }).success));
t("query: page and limit bounds", q({ page: "1" }).success && q({ page: "10000" }).success && !q({ page: "0" }).success && !q({ page: "10001" }).success && !q({ page: "1.5" }).success && !q({ page: "x" }).success && q({ limit: String(RESOURCE_LIST_MAX_LIMIT) }).success && !q({ limit: String(RESOURCE_LIST_MAX_LIMIT + 1) }).success && !q({ limit: "0" }).success && !q({ limit: "-1" }).success);
t("query: visibility is PUBLIC / LAB_ONLY; mine is only '1'", q({ visibility: "PUBLIC" }).success && q({ visibility: "LAB_ONLY" }).success && !q({ visibility: "SECRET" }).success && (q({ mine: "1" }) as { data: { mine: boolean } }).data.mine === true && !q({ mine: "2" }).success && !q({ mine: "true" }).success);
t("query: search text is split like the global search; '%' and '_' separate words; too many words / too long rejected", (() => {
  const r = q({ q: "Public  Data%set_x" }) as { success: boolean; data: { q: { terms: string[] } } };
  return r.success && r.data.q.terms.join() === "Public,Data,set,x" && !q({ q: "a b c d e f g h i" }).success && !q({ q: "a".repeat(101) }).success && q({ q: "a".repeat(100) }).success;
})());

// ---- permissions ---------------------------------------------------------------------------------------
const guest = null;
const member = { id: "m", role: "MEMBER" as const };
const manager = { id: "g", role: "LAB_MANAGER" as const };
const admin = { id: "a", role: "ADMIN" as const };
t("permissions: create = any signed-in account", !canCreateResource(guest) && !canCreateResource(undefined) && canCreateResource(member) && canCreateResource(manager) && canCreateResource(admin));
t("permissions: edit/delete = owner or manager", !canEditResource(guest, true) && !canEditResource(member, false) && canEditResource(member, true) && canEditResource(manager, false) && canEditResource(admin, false) && canDeleteResource(member, true) && !canDeleteResource(member, false) && canDeleteResource(manager, false) && !canDeleteResource(guest, true));
t("permissions: an unknown role grants nothing beyond being signed in (fails closed)", (() => {
  const odd = { id: "x", role: "SUPER" as never };
  return canCreateResource(odd) && canEditResource(odd, true) && !canEditResource(odd, false) && !canDeleteResource(odd, false) && !canFilterResourcesByVisibility(odd);
})());
t("permissions: the visibility filter is manager-only", !canFilterResourcesByVisibility(guest) && !canFilterResourcesByVisibility(member) && canFilterResourcesByVisibility(manager) && canFilterResourcesByVisibility(admin));

// ---- helpers ---------------------------------------------------------------------------------------------
t("isHttpUrl / safeResourceUrl: only http(s), otherwise empty", isHttpUrl("https://a.b") && !isHttpUrl("javascript:alert(1)") && !isHttpUrl("") && safeResourceUrl("javascript:alert(1)") === "" && safeResourceUrl("http://a.b/c") === "http://a.b/c" && safeResourceUrl("data:text/html,x") === "" && !isHttpUrl(`https://a.b/${"a".repeat(2100)}`));
t("resourceExcerpt: flattens whitespace, cuts at the cap with an ellipsis, never HTML-decodes", resourceExcerpt("a\n\n b\t c") === "a b c" && resourceExcerpt("x".repeat(300)).length === 201 && resourceExcerpt("x".repeat(300)).endsWith("…") && resourceExcerpt("&lt;b&gt;") === "&lt;b&gt;" && resourceExcerpt("short") === "short");
t("limits: section 5, panel 12, card names 3 projects, workspace section 5", RESOURCE_SECTION_LIMIT === 5 && RESOURCE_PANEL_LIMIT === 12 && RESOURCE_CARD_PROJECTS === 3 && WORKSPACE_LIMITS.resources === 5);
t("limits: default page 12, max page 50, at most 50 projects, name 200, description / notes 5000, metadata value 500", RESOURCE_LIST_DEFAULT_LIMIT === 12 && RESOURCE_LIST_MAX_LIMIT === 50 && RESOURCE_PROJECTS_MAX === 50 && RESOURCE_NAME_MAX === 200 && RESOURCE_DESCRIPTION_MAX === 5000 && RESOURCE_ENVIRONMENT_MAX === 5000 && RESOURCE_METADATA_VALUE_MAX === 500);

async function main() {
  // ---- serializer: visibility of relationships -------------------------------------------------------------
  const project = (id: string, visibility: string) => ({ project: { id, title: `Project ${id}` }, visibility });
  const row = (over: Partial<Record<string, unknown>> = {}): ResourceRow =>
    ({
      id: "r1",
      name: "Board X",
      resourceType: "BOARD",
      description: "A board",
      version: "rev B",
      vendor: "Acme",
      identifier: "ID-1",
      url: "https://example.com/x",
      environment: "notes",
      metadata: JSON.stringify({ hardwareRevision: "B", firmwareVersion: "1.2", evil: "x", format: "y" }),
      visibility: "LAB_ONLY",
      ownerId: "u-owner",
      researchAreaId: "a1",
      groupId: "g1",
      knowledgeDocId: "d1",
      publicationId: "p1",
      eventId: "e1",
      teamMemberId: "t1",
      createdAt: new Date("2030-01-01T00:00:00Z"),
      updatedAt: new Date("2030-01-02T00:00:00Z"),
      owner: { teamMember: { id: "tm-owner", name: "Ola Owner" } },
      teamMember: { id: "t1", name: "Rita Researcher" },
      researchArea: { id: "a1", title: "Area", visibility: "LAB_ONLY" },
      group: { id: "g1", name: "Group", visibility: "LAB_ONLY" },
      knowledgeDoc: { id: "d1", title: "Doc", visibility: "LAB_ONLY" },
      publication: { id: "p1", title: "Pub", visibility: "LAB_ONLY" },
      event: { id: "e1", title: "Event", visibility: "LAB_ONLY" },
      projectLinks: [{ project: { id: "pr1", title: "Project pr1" } }, { project: { id: "pr2", title: "Project pr2" } }],
      _count: { projectLinks: 2 },
      ...over,
    }) as unknown as ResourceRow;

  const [asMember] = await serializeResources([row()], member, "en", true);
  t("serialize: a member sees every visible relationship of a LAB_ONLY resource", asMember.projects.length === 2 && asMember.researchArea?.id === "a1" && asMember.group?.id === "g1" && asMember.knowledgeDoc?.id === "d1" && asMember.publication?.id === "p1" && asMember.event?.id === "e1");
  const [asGuest] = await serializeResources([row({ visibility: "PUBLIC" })], guest, "en", true);
  t("serialize: a guest sees NO relationship that is LAB_ONLY (no title, no id)", asGuest.researchArea === null && asGuest.group === null && asGuest.knowledgeDoc === null && asGuest.publication === null && asGuest.event === null && !JSON.stringify(asGuest).includes('"Doc"') && !JSON.stringify(asGuest).includes('"a1"'));
  const [pubRefs] = await serializeResources(
    [row({ visibility: "PUBLIC", researchArea: { id: "a1", title: "Area", visibility: "PUBLIC" }, group: { id: "g1", name: "Group", visibility: "PUBLIC" }, knowledgeDoc: { id: "d1", title: "Doc", visibility: "PUBLIC" }, publication: { id: "p1", title: "Pub", visibility: "PUBLIC" }, event: { id: "e1", title: "Event", visibility: "PUBLIC" } })],
    guest,
    "en",
    true,
  );
  t("serialize: ...and sees the PUBLIC ones", pubRefs.researchArea?.title === "Area" && pubRefs.group?.title === "Group" && pubRefs.knowledgeDoc?.title === "Doc" && pubRefs.publication?.title === "Pub" && pubRefs.event?.title === "Event");
  const [odd] = await serializeResources([row({ researchArea: { id: "a1", title: "Area", visibility: "PRIVATE" }, group: { id: "g1", name: "Group", visibility: "" }, event: { id: "e1", title: "Event", visibility: "lab_only" } })], admin, "en", true);
  t("serialize: a linked record whose visibility is outside the allow-list is hidden from EVERYONE, admins included", odd.researchArea === null && odd.group === null && odd.event === null);
  t("serialize: the project list and count come from the query (already visibility-filtered), never re-derived", asMember.projectCount === 2 && (await serializeResources([row({ projectLinks: [], _count: { projectLinks: 0 } })], guest, "en"))[0].projectCount === 0);
  const [summary] = await serializeResources([row({ projectLinks: [1, 2, 3, 4, 5].map((n) => ({ project: { id: `pr${n}`, title: `P${n}` } })), _count: { projectLinks: 5 } })], member, "en");
  t("serialize: a list card names at most 3 projects but reports the true count", summary.projects.length === RESOURCE_CARD_PROJECTS && summary.projectCount === 5);
  const [detail] = await serializeResources([row({ projectLinks: [1, 2, 3, 4, 5].map((n) => ({ project: { id: `pr${n}`, title: `P${n}` } })), _count: { projectLinks: 5 } })], member, "en", true);
  t("serialize: a detail names all of them", detail.projects.length === 5);
  t("serialize: the summary has no description / environment / metadata / related records (only the detail does)", !("description" in summary) && !("environment" in summary) && !("metadata" in summary) && !("knowledgeDoc" in summary) && "description" in asMember && "environment" in asMember && "metadata" in asMember);
  t("serialize: metadata is the type's allow-list only", JSON.stringify(asMember.metadata) === '{"hardwareRevision":"B","firmwareVersion":"1.2"}');
  t("serialize: an unknown stored type reads as OTHER, a non-http URL as empty", (await serializeResources([row({ resourceType: "WEIRD", url: "javascript:alert(1)" })], member, "en"))[0].resourceType === "OTHER" && (await serializeResources([row({ url: "javascript:alert(1)" })], member, "en"))[0].url === "");
  t("serialize: visibility is sent only to accounts that may change it", !("visibility" in asMember) && !("visibility" in asGuest) && (await serializeResources([row()], manager, "en"))[0].visibility === "LAB_ONLY" && (await serializeResources([row()], admin, "en"))[0].visibility === "LAB_ONLY");
  t("serialize: the owner is only the public team profile; no owner id or email anywhere in the output", asMember.owner?.name === "Ola Owner" && asMember.owner?.id === "tm-owner" && !JSON.stringify(asMember).includes("u-owner") && !("ownerId" in asMember));
  const [own] = await serializeResources([row()], { id: "u-owner", role: "MEMBER" }, "en");
  const [other] = await serializeResources([row()], member, "en");
  t("serialize: canEdit/canDelete follow ownership (owner id === viewer id), never the client", own.canEdit && own.canDelete && !other.canEdit && !other.canDelete);
  const [orphan] = await serializeResources([row({ ownerId: null, owner: null })], { id: "u-owner", role: "MEMBER" }, "en");
  t("serialize: a resource whose owner account was deleted has no owner", orphan.owner === null && !orphan.canEdit);
  const [orphanMgr] = await serializeResources([row({ ownerId: null, owner: null })], manager, "en");
  t("serialize: ...but a manager can still edit it", orphanMgr.canEdit && orphanMgr.canDelete);
  const [noProfile] = await serializeResources([row({ owner: { teamMember: null } })], guest, "en");
  t("serialize: an owner with no team profile is shown as no owner", noProfile.owner === null);
  const [noResearcher] = await serializeResources([row({ teamMember: null })], guest, "en");
  t("serialize: a resource with no related researcher has none", noResearcher.researcher === null);
  t("serialize: hostile text is passed through untouched as data (rendering is the UI's text nodes)", (await serializeResources([row({ name: "<script>alert(1)</script>", description: "<img src=x onerror=alert(1)>" })], guest, "en", true))[0].name === "<script>alert(1)</script>");
  const many = await serializeResources([row({ id: "r1" }), row({ id: "r2" }), row({ id: "r3" })], guest, "en");
  t("serialize: output keeps the input order; dates are ISO", many.map((x) => x.id).join() === "r1,r2,r3" && many[0].createdAt === "2030-01-01T00:00:00.000Z");
  t("serialize: an empty list is an empty list", (await serializeResources([], guest, "en")).length === 0);

  // ---- where / include / order ------------------------------------------------------------------------------
  const parse = (o: Record<string, unknown>) => resourceListQuerySchema.parse(o);
  const gw = JSON.stringify(await resourceWhere(parse({}), null));
  t("where: a guest is limited to PUBLIC and nothing else", gw === '{"AND":[{"visibility":{"in":["PUBLIC"]}}]}');
  const mw = JSON.stringify(await resourceWhere(parse({}), member));
  t("where: an account sees PUBLIC and LAB_ONLY, never anything else", mw === '{"AND":[{"visibility":{"in":["PUBLIC","LAB_ONLY"]}}]}');
  const fw = JSON.stringify(await resourceWhere(parse({ project: "p1", area: "a1", group: "g1", knowledge: "d1", publication: "b1", researcher: "t1", type: "DATASET" }), null));
  t("where: every relation filter also demands the linked record be visible to the viewer", fw.includes('"projectLinks":{"some":{"projectId":"p1","project":{"visibility":{"in":["PUBLIC"]}}}}') && fw.includes('"researchAreaId":"a1","researchArea":{"visibility":{"in":["PUBLIC"]}}') && fw.includes('"groupId":"g1","group":{"visibility":{"in":["PUBLIC"]}}') && fw.includes('"knowledgeDocId":"d1","knowledgeDoc":{"visibility":{"in":["PUBLIC"]}}') && fw.includes('"publicationId":"b1","publication":{"visibility":{"in":["PUBLIC"]}}'));
  t("where: type and researcher filters are exact matches", fw.includes('"resourceType":"DATASET"') && fw.includes('"teamMemberId":"t1"'));
  t("where: the visibility clause is ALWAYS first and always present", [gw, mw, fw].every((w) => w.startsWith('{"AND":[{"visibility":{"in":[')));
  const vw = JSON.stringify(await resourceWhere(parse({ visibility: "LAB_ONLY" }), manager));
  t("where: the manager visibility filter is ANDed after, never instead of, the viewer's own clause", vw === '{"AND":[{"visibility":{"in":["PUBLIC","LAB_ONLY"]}},{"visibility":"LAB_ONLY"}]}');
  const inc = resourceInclude(null, 3);
  t("include: only the public team profile of the owner is selected (no email, no user id)", JSON.stringify(inc.owner) === '{"select":{"teamMember":{"select":{"id":true,"name":true}}}}' && JSON.stringify(inc.teamMember) === '{"select":{"id":true,"name":true}}');
  t("include: the project links and the project count are filtered by the viewer's visibility and bounded", JSON.stringify(inc.projectLinks.where) === '{"project":{"visibility":{"in":["PUBLIC"]}}}' && inc.projectLinks.take === 3 && JSON.stringify(inc._count) === '{"select":{"projectLinks":{"where":{"project":{"visibility":{"in":["PUBLIC"]}}}}}}' && JSON.stringify(resourceInclude(member, 3).projectLinks.where) === '{"project":{"visibility":{"in":["PUBLIC","LAB_ONLY"]}}}');
  t("include: linked area/group/document/publication/event are selected with their visibility (checked per viewer), never their bodies", ["researchArea", "group", "knowledgeDoc", "publication", "event"].every((k) => (inc as Record<string, { select: Record<string, boolean> }>)[k].select.visibility === true) && !JSON.stringify(inc).includes('"body"') && !JSON.stringify(inc).includes('"email"') && !JSON.stringify(inc).includes('"passwordHash"'));
  t("order: most recently updated first, id breaks ties", JSON.stringify(resourceOrderBy) === '[{"updatedAt":"desc"},{"id":"asc"}]');
  t("resourceScope: a researcher with no profile only has what they own", resourceScope(member, null).length === 1 && JSON.stringify(resourceScope(member, null)[0]) === '{"ownerId":"m"}');
  const scope = resourceScope(member, "tm1");
  t("resourceScope: owned + named + own/group/area projects + own groups + own areas", scope.length === 5 && JSON.stringify(scope[0]) === '{"ownerId":"m"}' && JSON.stringify(scope[1]) === '{"teamMemberId":"tm1"}' && JSON.stringify(scope[2]).startsWith('{"projectLinks":{"some":{"project":'));
  t("resourceScope: every related project/group/area must itself be visible to the viewer", JSON.stringify(scope).split('"visibility":{"in":["PUBLIC","LAB_ONLY"]}').length - 1 >= 6);

  // ---- registrations --------------------------------------------------------------------------------------------
  t("search: 'resource' is the last search type (source order = type order)", SEARCH_TYPES[SEARCH_TYPES.length - 1] === "resource");
  t("translations: LAB_RESOURCE translates name, description and environment only", TRANSLATABLE_FIELDS.LAB_RESOURCE.join() === "name,description,environment");
  t("admin: resource is a content type with visibility and translations", (ADMIN_CONTENT_TYPES as readonly string[]).includes("resource") && hasVisibility("resource") && ADMIN_TRANSLATION_ENTITY.resource === "LAB_RESOURCE" && ADMIN_TRANSLATION_MAX.LAB_RESOURCE.description === 5000 && ADMIN_TRANSLATION_MAX.LAB_RESOURCE.name === 200);
  const a = (o: Record<string, unknown>) => adminContentQuerySchema.safeParse({ type: "resource", ...o });
  t("admin query: resourceType / project / area / group / owner apply to resources", a({ resourceType: "DATASET", project: "p1", area: "a1", group: "g1", owner: "t1", visibility: "PUBLIC" }).success);
  t("admin query: a bad type or id is rejected", !a({ resourceType: "nope" }).success && !a({ resourceType: "dataset" }).success && !a({ project: "a b" }).success && !a({ area: "../x" }).success && !a({ group: "a b" }).success && !a({ owner: "a b" }).success);
  t("admin query: event / knowledge / project-only filters do not apply to resources", !a({ kind: "SEMINAR" }).success && !a({ scope: "upcoming" }).success && !a({ status: "ACTIVE" }).success && !a({ category: "DATASET" }).success && !a({ newsType: "Paper" }).success);
  t("admin query: resourceType does not apply to other types", !adminContentQuerySchema.safeParse({ type: "knowledge", resourceType: "DATASET" }).success && !adminContentQuerySchema.safeParse({ type: "news", resourceType: "DATASET" }).success);
  t("admin query: knowledge filters still apply to knowledge", adminContentQuerySchema.safeParse({ type: "knowledge", category: "DATASET", project: "p1" }).success);
  t("admin: there is no message or notification content type", !ADMIN_CONTENT_TYPES.some((x) => /message|notification/.test(x)));

  // ---- i18n -----------------------------------------------------------------------------------------------------------
  const keys = Object.keys(en).filter((k) => k.startsWith("resource."));
  t("i18n: every resource.* key exists in ja, is non-empty, and keeps its {placeholders}", keys.length > 100 && keys.every((k) => {
    const e = (en as Record<string, string>)[k];
    const j = (ja as Record<string, string>)[k];
    const ph = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join();
    return typeof j === "string" && j.length > 0 && ph(e) === ph(j);
  }));
  t("i18n: the Japanese text is actually Japanese for prose keys", keys.filter((k) => !/^resource\.(type|family|meta)\./.test(k) && (en as Record<string, string>)[k].length > 12).every((k) => (ja as Record<string, string>)[k] !== (en as Record<string, string>)[k] && /[　-ヿ一-鿿]/.test((ja as Record<string, string>)[k])));
  t("i18n: the nav, search and admin labels exist in both languages", ["nav.resources", "search.type.resource", "search.filter.resource", "search.cta.resource", "adm.type.resource", "adm.ov.resource", "adm.tr.type.LAB_RESOURCE", "adm.f.resourceType", "adm.rel.docs"].every((k) => typeof (en as Record<string, string>)[k] === "string" && typeof (ja as Record<string, string>)[k] === "string"));
  t("i18n: ja and en have exactly the same keys", Object.keys(en).length === Object.keys(ja).length && Object.keys(en).every((k) => k in ja));

  console.log(`${ok} resource unit checks passed, ${failures.length} failed.`);
  if (failures.length) {
    for (const f of failures) console.log("  FAIL", f);
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

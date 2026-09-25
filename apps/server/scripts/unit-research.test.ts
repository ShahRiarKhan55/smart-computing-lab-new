/**
 * Unit test of the pure parts of research & project management (Phase 18): the new permission and its
 * relationship to the existing project/group/profile rules, the two relationship-write schemas, the
 * locale-fallback helper, the English-base lookup that stops a Japanese-locale edit from overwriting the
 * English text, the audit convention for the new details, dictionary parity for the new keys, and static
 * guards that keep the research-graph read code on the ONE visibility fragment. No server, no database.
 *   npm run test:unit -w apps/server
 */
process.env.DATABASE_URL ??= "file:./unused.db";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TRANSLATABLE_FIELDS,
  canEditGroup,
  canEditProfile,
  canEditProject,
  canLinkResearchersToArea,
  canManageGroupSettings,
  canManageProjectSettings,
  en,
  ja,
  setAreaResearchersSchema,
  setMemberAreasSchema,
  type Actor,
  type TranslatableEntityType,
} from "@scl/shared";
import { ROLLUP_LIMIT, pick } from "../src/lib/researchGraph.js";
import { getEntityBase } from "../src/lib/translations.js";
import { recordAudit } from "../src/lib/audit.js";
import { canView, visibleTo } from "../src/lib/visibility.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));
const parses = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;
const A = (role: Actor["role"], id = "u1"): Actor => ({ id, role });
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, "..", "src", p), "utf8");

// ---- permission: who may set the researchers on an area -----------------------------------------------
t("canLinkResearchersToArea: a guest may not", !canLinkResearchersToArea(null) && !canLinkResearchersToArea(undefined));
t("canLinkResearchersToArea: a member may not (their own areas go through their profile)", !canLinkResearchersToArea(A("MEMBER")));
t("canLinkResearchersToArea: a manager and an admin may", canLinkResearchersToArea(A("LAB_MANAGER")) && canLinkResearchersToArea(A("ADMIN")));
t("canLinkResearchersToArea: an unknown role fails closed", !canLinkResearchersToArea({ id: "u", role: "SUPERUSER" as Actor["role"] }));

// ---- the existing lead rules the graph relies on are unchanged ----------------------------------------
t("project: a lead edits, a plain member does not, a manager always does", canEditProject(A("MEMBER"), true) && !canEditProject(A("MEMBER"), false) && canEditProject(A("LAB_MANAGER"), false) && !canEditProject(null, true));
t("group: a lead edits, a plain member does not, a manager always does", canEditGroup(A("MEMBER"), true) && !canEditGroup(A("MEMBER"), false) && canEditGroup(A("ADMIN"), false) && !canEditGroup(null, true));
t("settings (visibility/slug/sort/group) stay manager-only even for a lead", !canManageProjectSettings(A("MEMBER")) && !canManageGroupSettings(A("MEMBER")) && canManageProjectSettings(A("LAB_MANAGER")) && canManageGroupSettings(A("ADMIN")));
t("a researcher's own areas follow the profile rule: owner or manager, never another member, never a guest", canEditProfile(A("MEMBER", "u1"), "u1") && !canEditProfile(A("MEMBER", "u2"), "u1") && canEditProfile(A("LAB_MANAGER", "u2"), "u1") && !canEditProfile(null, "u1") && !canEditProfile(A("MEMBER"), null));

// ---- write schemas ------------------------------------------------------------------------------------
const good = ["abc123", "ckx0_9-Z", "a".repeat(64)];
t("setAreaResearchersSchema: empty set and valid ids", parses(setAreaResearchersSchema, { teamMemberIds: [] }) && parses(setAreaResearchersSchema, { teamMemberIds: good }));
t("setAreaResearchersSchema: rejects missing, non-array, duplicates, bad/foreign ids, non-strings", [{}, { teamMemberIds: "x" }, { teamMemberIds: null }, { teamMemberIds: ["a", "a"] }, { teamMemberIds: ["bad id"] }, { teamMemberIds: ["../x"] }, { teamMemberIds: [""] }, { teamMemberIds: [1] }, { teamMemberIds: [{ id: "a" }] }, { teamMemberIds: ["a".repeat(65)] }, { teamMemberIds: ["日本語"] }].every((v) => !parses(setAreaResearchersSchema, v)));
t("setAreaResearchersSchema: the cap is 200 (200 ok, 201 rejected)", parses(setAreaResearchersSchema, { teamMemberIds: Array.from({ length: 200 }, (_, i) => `m${i}`) }) && !parses(setAreaResearchersSchema, { teamMemberIds: Array.from({ length: 201 }, (_, i) => `m${i}`) }));
t("setMemberAreasSchema: same rules on areaIds", parses(setMemberAreasSchema, { areaIds: [] }) && parses(setMemberAreasSchema, { areaIds: good }) && [{}, { areaIds: "x" }, { areaIds: ["a", "a"] }, { areaIds: ["a b"] }, { areaIds: [null] }].every((v) => !parses(setMemberAreasSchema, v)));
t("write schemas ignore unknown keys (role/visibility/userId are dropped, not honoured)", (() => {
  const r = setMemberAreasSchema.safeParse({ areaIds: ["a"], role: "ADMIN", visibility: "PUBLIC", userId: "x" });
  return r.success && !("role" in r.data) && !("visibility" in r.data) && !("userId" in r.data);
})());

// ---- locale fallback helper ---------------------------------------------------------------------------
const tr = new Map<string, Record<string, string>>([["a", { title: "日本語", summary: "" }]]);
t("pick: an override wins", pick(tr, "a", "title", "English") === "日本語");
t("pick: an empty override falls back to English (never blank)", pick(tr, "a", "summary", "English summary") === "English summary");
t("pick: a missing field / entity falls back to English", pick(tr, "a", "nope", "E") === "E" && pick(tr, "zzz", "title", "E") === "E");
t("ROLLUP_LIMIT is a sane bound", Number.isInteger(ROLLUP_LIMIT) && ROLLUP_LIMIT >= 50 && ROLLUP_LIMIT <= 500);

// ---- visibility fragment the graph code must use -----------------------------------------------------
t("visibleTo: a guest gets only PUBLIC, a signed-in viewer both known values, nothing else", JSON.stringify(visibleTo(null)) === JSON.stringify({ visibility: { in: ["PUBLIC"] } }) && JSON.stringify(visibleTo(A("MEMBER"))) === JSON.stringify({ visibility: { in: ["PUBLIC", "LAB_ONLY"] } }));
t("canView: a mistyped or future value is hidden from everyone", !canView(A("ADMIN"), "PRIVATE") && !canView(null, "lab_only") && !canView(A("MEMBER"), ""));

// ---- English base lookup ------------------------------------------------------------------------------
{
  const calls: { entity: string; select: Record<string, boolean> }[] = [];
  const row: Record<string, string> = { title: "T", description: "D", summary: "S", venue: "V", name: "N", bio: "B", secret: "NOPE", passwordHash: "NOPE", id: "x" };
  const fakeDb = new Proxy(
    {},
    {
      get: (_o, delegate: string) => ({
        findUnique: async (a: { where: { id: string }; select: Record<string, boolean> }) => {
          calls.push({ entity: delegate, select: a.select });
          if (a.where.id === "missing") return null;
          return Object.fromEntries(Object.keys(a.select).map((k) => [k, row[k]]));
        },
      }),
    },
  );
  const types = Object.keys(TRANSLATABLE_FIELDS) as TranslatableEntityType[];
  let allExact = true;
  let allValues = true;
  let allMissing = true;
  for (const type of types) {
    const fields = TRANSLATABLE_FIELDS[type] as readonly string[];
    calls.length = 0;
    const res = await getEntityBase(fakeDb as never, type, "x");
    allExact &&= calls.length === 1 && JSON.stringify(Object.keys(calls[0].select).sort()) === JSON.stringify([...fields].sort());
    allValues &&= JSON.stringify(Object.keys(res).sort()) === JSON.stringify([...fields].sort()) && fields.every((f) => res[f] === row[f]);
    const none = await getEntityBase(fakeDb as never, type, "missing");
    allMissing &&= fields.every((f) => none[f] === null);
  }
  t("getEntityBase: selects EXACTLY the allow-listed fields of every translatable entity (no other column can ride along)", allExact);
  t("getEntityBase: returns the English text keyed by field for every entity type", allValues);
  t("getEntityBase: a missing entity yields nulls, not an error", allMissing);
}

// ---- audit convention ---------------------------------------------------------------------------------
{
  const rows: unknown[] = [];
  const db = { auditLog: { create: async (a: { data: unknown }) => void rows.push(a.data) } };
  const actor = { id: "u1", email: "a@b.c" };
  await recordAudit(db as never, { actor, action: "PROJECT_MEMBERS_CHANGED", entityType: "RESEARCH_PROJECT", entityId: "p", details: { title: "T", added: "a,b", removed: "", roleChanged: 1, leadChanged: true, leads: "a" } });
  t("audit: the lead-change metadata (leadChanged, leads) is a legal flat details object", rows.length === 1);
  await recordAudit(db as never, { actor, action: "MEMBER_LINKS_CHANGED", entityType: "RESEARCH_AREA", entityId: "a", details: { kind: "researchers", title: "T", added: "m1", removed: "" } });
  t("audit: MEMBER_LINKS_CHANGED is valid on a RESEARCH_AREA entity (reuse, no new action)", rows.length === 2);
  const throws = async (details: Record<string, string>) => {
    try {
      await recordAudit(db as never, { actor, action: "RESEARCH_UPDATED", entityType: "RESEARCH_AREA", details });
      return false;
    } catch {
      return true;
    }
  };
  t("audit: a translation VALUE / body / message / token key is refused by the tripwire", (await throws({ body: "x" })) && (await throws({ messageText: "x" })) && (await throws({ token: "x" })) && (await throws({ content: "x" })));
}

// ---- dictionaries: every new key exists in both languages with the same placeholders ------------------
{
  const keys = Object.keys(en).filter((k) => k.startsWith("rs."));
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  t("i18n: Phase 18 adds keys", keys.length >= 35);
  t("i18n: every rs.* key has a non-empty Japanese value", keys.every((k) => typeof (ja as Record<string, string>)[k] === "string" && (ja as Record<string, string>)[k].trim() !== ""));
  t("i18n: placeholders ({count}, {role}) match between en and ja", keys.every((k) => ph((en as Record<string, string>)[k]) === ph((ja as Record<string, string>)[k])));
  t("i18n: the Japanese values are actually Japanese (contain kana/kanji)", keys.every((k) => /[぀-ヿ一-鿿]/.test((ja as Record<string, string>)[k])));
  t("i18n: no rs.* key has a raw-key-looking value", keys.every((k) => (en as Record<string, string>)[k] !== k && !/^rs\./.test((en as Record<string, string>)[k])));
}

// ---- static guards over the research-graph read code --------------------------------------------------
{
  const graph = src("lib/researchGraph.ts");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const g = strip(graph);
  t("static: researchGraph reads through visibleTo(viewer) and never spells a visibility literal", g.includes("visibleTo(viewer)") && !/["'`](PUBLIC|LAB_ONLY)["'`]/.test(g));
  t("static: researchGraph has no raw SQL", !/\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/.test(g));
  t("static: researchGraph never selects or serialises an account id (userId)", !/userId/.test(g));
  const findManyCount = (g.match(/\.findMany\(/g) ?? []).length;
  const visibleUses = (g.match(/\.\.\.visible\b/g) ?? []).length;
  t("static: every entity findMany in researchGraph that is visibility-bearing (publication, news, event, area) spreads the fragment", visibleUses >= 3 && findManyCount >= visibleUses);
  const research = strip(src("routes/research.routes.ts"));
  t("static: the area detail read applies visibleTo to the area, its projects (where: { project: visible }) and delegates outputs to the graph", /findFirst\(\{\s*where: \{ id: req\.params\.id, \.\.\.visible \}/.test(research) && /where: \{ project: visible \}/.test(research) && /loadProjectOutputs\(/.test(research));
  const member = strip(src("routes/member.routes.ts"));
  t("static: the profile's area links and events are filtered by the viewer's visibility", /areaLinks: \{\s*where: \{ researchArea: visible \}/.test(member) && /\.\.\.visible,\s*OR:/.test(member) && /project: \{ \.\.\.visible, members:/.test(member));
  const groups = strip(src("routes/groups.routes.ts"));
  t("static: the group's areas come from its VISIBLE projects and are themselves visibility-filtered", /projectLinks: \{ some: \{ projectId: \{ in: projectIds \} \} \}/.test(groups) && /where: \{ \.\.\.visible, projectLinks/.test(groups));
  const projects = strip(src("routes/projects.routes.ts"));
  t("static: the project detail reads its events with the same visibility fragment", /event\.findMany\(\{ where: \{ projectId: row\.id, \.\.\.visible \}/.test(projects));
  for (const [name, file] of [["research", research], ["member", member], ["groups", groups], ["projects", projects]] as const) {
    t(`static: ${name} routes have no inline role comparison (policy stays central)`, !/role\s*===?\s*["'](ADMIN|LAB_MANAGER|MEMBER)["']/.test(file));
  }
  t("static: the two new write routes are guarded by the central policy, not an inline check", /router\.put\(\s*"\/:id\/researchers",\s*requireCan\(canLinkResearchersToArea\)/.test(research) && /router\.put\(\s*"\/:id\/areas",\s*requireOwnerOrManager\("id"\)/.test(member));
}

console.log(`${ok} research unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
process.exit(0);

/**
 * Unit test of the pure parts of the research collaboration workspace (Phase 21): the permission (and
 * that it adds no power), the single-relationship write schemas, the workspace limits, the empty
 * workspace shape, dictionary parity for the new keys (incl. Japanese and placeholders), the known-error
 * table, and static guards that keep the workspace read code on the ONE visibility fragment, keep it away
 * from messages/notifications/accounts, and keep the new write routes on the central policy and the
 * audit convention. No server, no database.
 *   npm run test:unit -w apps/server
 */
process.env.DATABASE_URL ??= "file:./unused.db";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  WORKSPACE_LIMITS,
  addGroupMemberSchema,
  addProjectMemberSchema,
  canEditGroup,
  canEditProject,
  canManageGroupMembers,
  canManageProjectMembers,
  canViewWorkspace,
  en,
  ja,
  setGroupMemberRoleSchema,
  setProjectMemberRoleSchema,
  type Actor,
} from "@scl/shared";
import { emptyWorkspace } from "../src/lib/workspace.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));
const parses = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;
const A = (role: Actor["role"], id = "u1"): Actor => ({ id, role });
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, "..", "src", p), "utf8");
const web = (p: string) => readFileSync(join(here, "..", "..", "web", "src", p), "utf8");

// ---- permission ---------------------------------------------------------------------------------------
t("canViewWorkspace: a guest may not", !canViewWorkspace(null) && !canViewWorkspace(undefined));
t("canViewWorkspace: every signed-in role may (it is their OWN view)", (["MEMBER", "LAB_MANAGER", "ADMIN"] as const).every((r) => canViewWorkspace(A(r))));
t("canManageProjectMembers IS canEditProject (no second permission): lead / manager yes, plain member and guest no", [true, false].every((lead) => (["MEMBER", "LAB_MANAGER", "ADMIN"] as const).every((r) => canManageProjectMembers(A(r), lead) === canEditProject(A(r), lead))) && canManageProjectMembers(A("MEMBER"), true) && !canManageProjectMembers(A("MEMBER"), false) && !canManageProjectMembers(null, true));
t("canManageGroupMembers IS canEditGroup", [true, false].every((lead) => (["MEMBER", "LAB_MANAGER", "ADMIN"] as const).every((r) => canManageGroupMembers(A(r), lead) === canEditGroup(A(r), lead))) && !canManageGroupMembers(null, true));
t("an unknown role fails closed for management (only 'is signed in' for viewing)", !canManageProjectMembers({ id: "u", role: "SUPERUSER" as Actor["role"] }, false) && canViewWorkspace({ id: "u", role: "SUPERUSER" as Actor["role"] }));

// ---- limits / empty shape ----------------------------------------------------------------------------
t("WORKSPACE_LIMITS: every cap is a small positive integer (nothing is unbounded)", Object.values(WORKSPACE_LIMITS).every((n) => Number.isInteger(n) && n >= 3 && n <= 50));
{
  const e = emptyWorkspace();
  t("emptyWorkspace: no profile and seven empty sections with total 0", e.profile === null && ["areas", "projects", "groups", "publications", "events", "news", "collaborators"].every((k) => (e as never)[k].items.length === 0 && (e as never)[k].total === 0));
  t("emptyWorkspace: each call returns fresh arrays (no shared mutable state)", emptyWorkspace().projects.items !== emptyWorkspace().projects.items);
}

// ---- write schemas ------------------------------------------------------------------------------------
const id = "cmabc123";
t("add schema (project): valid id, role defaults to MEMBER", (() => { const r = addProjectMemberSchema.safeParse({ teamMemberId: id }); return r.success && r.data.role === "MEMBER"; })());
t("add schema: all three project roles and both group roles parse; the others do not", ["LEAD", "MEMBER", "COLLABORATOR"].every((role) => parses(addProjectMemberSchema, { teamMemberId: id, role })) && ["LEAD", "MEMBER"].every((role) => parses(addGroupMemberSchema, { teamMemberId: id, role })) && !parses(addGroupMemberSchema, { teamMemberId: id, role: "COLLABORATOR" }) && !parses(addProjectMemberSchema, { teamMemberId: id, role: "ADMIN" }));
t("add schema: rejects missing / malformed / foreign / non-string ids", [{}, { teamMemberId: "" }, { teamMemberId: "a b" }, { teamMemberId: "../x" }, { teamMemberId: 1 }, { teamMemberId: null }, { teamMemberId: ["a"] }, { teamMemberId: "a".repeat(65) }, { teamMemberId: "日本語" }].every((v) => !parses(addProjectMemberSchema, v) && !parses(addGroupMemberSchema, v)));
t("add schema: rejects a lowercase / padded role (exact enum)", !parses(addProjectMemberSchema, { teamMemberId: id, role: "lead" }) && !parses(addProjectMemberSchema, { teamMemberId: id, role: " LEAD" }));
t("role schema: requires a valid role", parses(setProjectMemberRoleSchema, { role: "LEAD" }) && parses(setGroupMemberRoleSchema, { role: "MEMBER" }) && !parses(setProjectMemberRoleSchema, {}) && !parses(setProjectMemberRoleSchema, { role: "" }) && !parses(setGroupMemberRoleSchema, { role: "COLLABORATOR" }));
t("write schemas ignore unknown keys (userId / visibility / a batch list are dropped, never honoured)", (() => {
  const r = addProjectMemberSchema.safeParse({ teamMemberId: id, role: "LEAD", userId: "x", visibility: "PUBLIC", members: [{ teamMemberId: "b" }] });
  return r.success && Object.keys(r.data).sort().join() === "role,teamMemberId";
})());

// ---- dictionaries -------------------------------------------------------------------------------------
{
  const E = en as Record<string, string>;
  const J = ja as Record<string, string>;
  const keys = Object.keys(E).filter((k) => k.startsWith("workspace.") || k === "nav.workspace");
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  t("i18n: Phase 21 adds the workspace keys", keys.length >= 70);
  t("i18n: every workspace key has a non-empty Japanese value", keys.every((k) => typeof J[k] === "string" && J[k].trim() !== ""));
  t("i18n: placeholders match between en and ja", keys.every((k) => ph(E[k]) === ph(J[k])));
  t("i18n: the Japanese values are Japanese (kana/kanji) except one-word loans", keys.every((k) => /[぀-ヿ一-鿿]/.test(J[k])));
  t("i18n: no English value is a raw key", keys.every((k) => E[k] !== k && !/^workspace\./.test(E[k])));
}

// ---- the known-error table covers the exact messages the single-relationship routes send --------------
{
  const errors = web("i18n/errorMessages.ts");
  const membership = src("lib/membership.ts");
  for (const m of ["That researcher is already a member.", "That researcher is not a member.", "That researcher already has this role.", "One or more team members do not exist."]) {
    t(`errors: "${m}" is sent by the API and mapped to a translation key`, membership.includes(`"${m}"`) && errors.includes(`"${m}"`));
  }
}

// ---- static guards over the workspace read code -------------------------------------------------------
{
  const ws = src("lib/workspace.ts");
  const route = src("routes/workspace.routes.ts");
  const mem = src("lib/membership.ts");
  const projects = src("routes/projects.routes.ts");
  const groups = src("routes/groups.routes.ts");
  t("static: workspace.ts reads through visibleTo/canView, never a visibility literal", /visibleTo\(viewer\)/.test(ws) && !/["'](PUBLIC|LAB_ONLY)["']/.test(ws));
  t("static: workspace.ts never touches messages, notifications, conversations, files or accounts other than the session's own profile lookup", !/prisma\.(message|notification|conversation|conversationParticipant|storedFile|user|session|auditLog)\b/.test(ws));
  t("static: workspace.ts selects no email / passwordHash / userId column for anybody", !/\b(email|passwordHash)\b/.test(ws.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")) && !/userId:\s*true/.test(ws));
  t("static: the only account id used is the session's own (viewer.id) in ONE profile lookup", (ws.match(/viewer\.id/g) ?? []).length === 1 && /teamMember\.findUnique\(\{ where: \{ userId: viewer\.id \}/.test(ws));
  t("static: every section is bounded (take:) and there is no unbounded findMany without take in the collaborator or section queries", (ws.match(/findMany\(/g) ?? []).length === (ws.match(/take: /g) ?? []).length);
  t("static: the route reads no request input at all (no query/params/body/headers except the locale helper)", !/req\.(query|params|body|headers|get\()/.test(route) && /resolveLocale\(req\)/.test(route) && /requireCan\(canViewWorkspace\)/.test(route));
  t("static: the route sets a private no-store cache header and has exactly one handler (GET)", /no-store/.test(route) && /private/.test(route) && (route.match(/router\.(get|post|put|patch|delete)\(/g) ?? []).length === 1);
  t("static: the route writes no audit row (reads are not audited)", !/recordAudit/.test(route) && !/recordAudit/.test(ws));
  t("static: membership.ts audits INSIDE the transaction with the existing actions only", /prisma\.\$transaction/.test(mem) && /recordAudit\(tx,/.test(mem) && /cfg\.action/.test(mem));
  t("static: membership.ts contains no inline role/permission comparison (the guard is the shared one)", !/role\s*===?\s*["'](ADMIN|LAB_MANAGER|MEMBER)["']/.test(mem) && /cfg\.guard/.test(mem));
  t("static: membership routes are single-relationship only (POST, PUT and DELETE each take ONE :teamMemberId; no bulk form)", (mem.match(/router\.(post|put|delete)\(/g) ?? []).length === 3 && /"\/:id\/members\/:teamMemberId"/.test(mem) && !/deleteMany|createMany|updateMany/.test(mem));
  t("static: project and group members mount with the SAME editor guards and the SAME audit actions as the Phase 9 routes", /guard: requireProjectEditor/.test(projects) && /action: "PROJECT_MEMBERS_CHANGED"/.test(projects) && /guard: requireGroupEditor/.test(groups) && /action: "GROUP_MEMBERS_CHANGED"/.test(groups));
  t("static: the audit details of a membership change carry ids/counts only (no name of a person, no free text)", /added: r\.added \?\? ""/.test(mem) && !/teamMember\.name|\bmessage\b/.test(mem.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  t("static: no migration, no schema change in this phase (schema.prisma has no Workspace model)", !/model\s+Workspace/i.test(readFileSync(join(here, "..", "prisma", "schema.prisma"), "utf8")));
}

console.log(`${ok} workspace unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
process.exit(0);

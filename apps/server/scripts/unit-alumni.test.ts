/**
 * Unit checks for Phase 3B (alumni directory, publication consent). No server, no network, no shared database: the migration
 * check runs the repository's own migration files against a disposable local file.   npm run test:unit -w apps/server
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { ALUMNI_MESSAGES, accountCategorySchema, canManageAlumni, canPublishMember, categorySchema, createInvitationSchema, createUserSchema, createTeamMemberSchema, setPublicationSchema } from "@scl/shared";
import { isMemberVisible, publishedMemberWhere, rejectPublicationField, seesUnpublishedMembers } from "../src/lib/memberVisibility.ts";
import { assertMayBecomeAlumni, assertProfileMayHaveAccount, isAlumniCategory } from "../src/lib/alumni.ts";
import { HttpError } from "../src/lib/validate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "..");
let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));
const throwsHttp = (fn: () => void, status: number, text?: string) => { try { fn(); return false; } catch (e) { return e instanceof HttpError && e.status === status && (!text || e.message === text); } };

// ---- shared definitions ------------------------------------------------------------------------------------------------------
t("categorySchema accepts ALUMNI", categorySchema.safeParse("ALUMNI").success);
t("accountCategorySchema (profiles created WITH a login) refuses ALUMNI", !accountCategorySchema.safeParse("ALUMNI").success && accountCategorySchema.safeParse("PHD").success);
const acct = { email: "a@example.test", password: "Another123!pass" };
t("createUserSchema refuses a new ALUMNI profile", !createUserSchema.safeParse({ ...acct, name: "N", initials: "N", memberRole: "r", category: "ALUMNI" }).success);
t("createUserSchema still accepts a normal new profile", createUserSchema.safeParse({ ...acct, name: "N", initials: "N", memberRole: "r", category: "MSC" }).success);
t("createInvitationSchema refuses a new ALUMNI profile", !createInvitationSchema.safeParse({ email: "a@example.test", name: "N", initials: "N", memberRole: "r", category: "ALUMNI" }).success);
t("createTeamMemberSchema accepts ALUMNI (admin-only is enforced by the route)", createTeamMemberSchema.safeParse({ name: "N", initials: "N", role: "r", category: "ALUMNI" }).success);
t("the create/update team schemas carry no publication field", !("isPublished" in createTeamMemberSchema.shape));
t("setPublicationSchema is strict and boolean only", setPublicationSchema.safeParse({ isPublished: true }).success && !setPublicationSchema.safeParse({ isPublished: "true" }).success && !setPublicationSchema.safeParse({ isPublished: true, x: 1 }).success && !setPublicationSchema.safeParse({}).success);
const admin = { id: "a", role: "ADMIN" as const }, mgr = { id: "m", role: "LAB_MANAGER" as const }, mem = { id: "u", role: "MEMBER" as const };
t("canManageAlumni / canPublishMember: admin only", canManageAlumni(admin) && canPublishMember(admin) && !canManageAlumni(mgr) && !canPublishMember(mgr) && !canManageAlumni(mem) && !canPublishMember(mem) && !canManageAlumni(null) && !canPublishMember(undefined));

// ---- the visibility rule -----------------------------------------------------------------------------------------------------
t("only an administrator sees unpublished profiles", seesUnpublishedMembers(admin) && !seesUnpublishedMembers(mgr) && !seesUnpublishedMembers(mem) && !seesUnpublishedMembers(null));
t("publishedMemberWhere: {} for an admin, { isPublished: true } for everyone else", Object.keys(publishedMemberWhere(admin)).length === 0 && JSON.stringify(publishedMemberWhere(mgr)) === '{"isPublished":true}' && JSON.stringify(publishedMemberWhere(null)) === '{"isPublished":true}');
t("isMemberVisible is strict: only `true` is public (false, null, undefined are private)", isMemberVisible(null, { isPublished: true }) && !isMemberVisible(null, { isPublished: false }) && !isMemberVisible(null, { isPublished: null }) && !isMemberVisible(null, {}) && !isMemberVisible(mgr, { isPublished: false }) && isMemberVisible(admin, { isPublished: false }));
t("isMemberVisible: a string or number that looks truthy is NOT published", !isMemberVisible(null, { isPublished: "true" as unknown as boolean }) && !isMemberVisible(null, { isPublished: 1 as unknown as boolean }));
t("rejectPublicationField refuses any payload that names the flag", throwsHttp(() => rejectPublicationField({ name: "x", isPublished: true }), 400, ALUMNI_MESSAGES.publicationField) && throwsHttp(() => rejectPublicationField({ isPublished: false }), 400));
t("rejectPublicationField lets ordinary payloads through", !throwsHttp(() => rejectPublicationField({ name: "x" }), 400) && !throwsHttp(() => rejectPublicationField(null), 400) && !throwsHttp(() => rejectPublicationField([{ isPublished: true }]), 400));

// ---- the account invariant helpers -------------------------------------------------------------------------------------------
t("isAlumniCategory", isAlumniCategory("ALUMNI") && !isAlumniCategory("PHD") && !isAlumniCategory(null) && !isAlumniCategory("alumni"));
t("assertProfileMayHaveAccount refuses ALUMNI (409) and allows the others", throwsHttp(() => assertProfileMayHaveAccount({ category: "ALUMNI" }), 409, ALUMNI_MESSAGES.noAccount) && !throwsHttp(() => assertProfileMayHaveAccount({ category: "FACULTY" }), 409));
t("assertMayBecomeAlumni refuses a profile with an account (409)", throwsHttp(() => assertMayBecomeAlumni({ userId: "u1" }), 409, ALUMNI_MESSAGES.hasAccount) && !throwsHttp(() => assertMayBecomeAlumni({ userId: null }), 409));

// ---- Google sign-in never creates accounts or profiles (static check of the source) ------------------------------------------------
for (const f of ["src/routes/googleAuth.routes.ts", "src/lib/googleIdentity.ts", "src/lib/googleOAuth.ts"]) {
  const src = readFileSync(path.join(SERVER, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  t(`${f}: never touches teamMember or creates a user`, !/teamMember/i.test(src) && !/user\.create\(|user\.upsert\(/.test(src));
}

// ---- the migration, against a disposable local file with pre-existing rows ----------------------------------------------------------
const migDir = path.join(SERVER, "prisma", "migrations");
const names = readdirSync(migDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const MIG = "20261020120000_team_member_is_published";
// Phase 3C added one later, separately reviewed migration; the state "before this migration" is every migration that sorts earlier.
t("the migration directory exists and only the Phase 3C research-links migration follows it", names.includes(MIG) && names.slice(names.indexOf(MIG) + 1).join(",") === "20261027120000_team_member_research_links");
const migSql = readFileSync(path.join(migDir, MIG, "migration.sql"), "utf8");
const statements = migSql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
t("the migration is ONE plain ALTER TABLE ADD COLUMN (no DROP, no table copy, no data rewrite)", statements.length === 1 && /^ALTER TABLE "TeamMember" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true$/.test(statements[0]) && !/\b(DROP|INSERT|UPDATE|DELETE|CREATE|PRAGMA)\b/i.test(statements[0]));

const dir = mkdtempSync(path.join(tmpdir(), "scl-alumni-migration-"));
const db = createClient({ url: `file:${path.join(dir, "m.db")}` });
try {
  for (const n of names.filter((x) => x < MIG)) await db.executeMultiple(readFileSync(path.join(migDir, n, "migration.sql"), "utf8"));
  const colsBefore = (await db.execute(`PRAGMA table_info("TeamMember")`)).rows.map((r) => String(r.name));
  t("before: TeamMember has no isPublished", !colsBefore.includes("isPublished"));
  const now = new Date().toISOString();
  for (const [id, name, cat] of [["tm1", "Existing Faculty", "FACULTY"], ["tm2", "Existing Student", "PHD"]]) {
    await db.execute({ sql: `INSERT INTO "TeamMember" ("id","name","initials","role","category","updatedAt") VALUES (?,?,?,?,?,?)`, args: [id, name, "EX", "r", cat, now] });
  }
  await db.execute({ sql: `INSERT INTO "HistoryEntry" ("id","teamMemberId","year","title","updatedAt") VALUES ('h1','tm1','2020','t',?)`, args: [now] });
  await db.execute("PRAGMA foreign_keys = ON");

  await db.executeMultiple(migSql);

  const rows = (await db.execute(`SELECT "id","isPublished","name" FROM "TeamMember" ORDER BY "id"`)).rows;
  t("after: both pre-existing rows are still there, unchanged, and PUBLISHED (isPublished = 1)", rows.length === 2 && rows.every((r) => Number(r.isPublished) === 1) && rows[0].name === "Existing Faculty");
  t("after: the dependent history row survived (no cascade from a table rebuild)", Number((await db.execute(`SELECT COUNT(*) AS c FROM "HistoryEntry"`)).rows[0].c) === 1);
  t("after: no foreign-key violations", (await db.execute("PRAGMA foreign_key_check")).rows.length === 0);
  const col = (await db.execute(`PRAGMA table_info("TeamMember")`)).rows.find((r) => r.name === "isPublished");
  t("after: isPublished is BOOLEAN NOT NULL DEFAULT true", Boolean(col) && String(col!.type) === "BOOLEAN" && Number(col!.notnull) === 1 && String(col!.dflt_value) === "true");
  await db.execute({ sql: `INSERT INTO "TeamMember" ("id","name","initials","role","category","updatedAt") VALUES ('tm3','Old-code insert','OC','r','BSC',?)`, args: [now] });
  t("an INSERT from code that does not know the column (rollback / old code) takes the default: published", Number((await db.execute(`SELECT "isPublished" AS p FROM "TeamMember" WHERE "id"='tm3'`)).rows[0].p) === 1);
  await db.execute({ sql: `INSERT INTO "TeamMember" ("id","name","initials","role","category","isPublished","updatedAt") VALUES ('tm4','New alumnus','NA','r','ALUMNI',0,?)`, args: [now] });
  t("an explicit alumni INSERT with isPublished = 0 stays unpublished", Number((await db.execute(`SELECT "isPublished" AS p FROM "TeamMember" WHERE "id"='tm4'`)).rows[0].p) === 0);
  const idx = (await db.execute(`PRAGMA index_list("TeamMember")`)).rows.map((r) => String(r.name));
  t("after: the existing indexes are intact", idx.includes("TeamMember_userId_key") && idx.includes("TeamMember_category_sortOrder_idx"));
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`${ok} alumni unit checks passed, ${failures.length} failed.`);
if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }

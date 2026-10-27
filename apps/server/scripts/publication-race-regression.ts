/**
 * Regression for the publication / category-change interleaving on PUT /api/team/:id/publication.
 *
 * The publication endpoint reads the profile (category ALUMNI), and then writes `isPublished`. If an administrator changes the
 * category away from ALUMNI between that read and that write, the stale write used to set `isPublished = false` on a profile that is
 * no longer alumni, leaving it hidden. The write is now a compare-and-swap: it only applies while the profile STILL has the category
 * and publication state that the request read (otherwise 409, nothing written, no audit row).
 *
 * HOW THE INTERLEAVING IS MODELLED (and what this proves): the competing change is applied deterministically through the SAME
 * transaction, right after the endpoint's read and before its write. The database therefore holds exactly the state a concurrent
 * committed category change would have produced. This proves the endpoint's WRITE is conditional on the state it read. It does NOT
 * prove behaviour under real concurrent connections: one process, serialised transactions. Whether a stale write is even possible on
 * a remote Turso database is a separate, unverified question (docs/architecture/phase3-release-runbook.md, scenario 12).
 *
 * Real application, brand-new SQLite file built from the repository's migrations. Refuses to run if TURSO_* is set.
 *   npx tsx scripts/publication-race-regression.ts   (or: npm run test:publication-race -w apps/server)
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error("Refusing to run: Turso variables are set. Unset TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.");
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, "..", "prisma", "migrations");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scl-pubrace-"));
const dbFile = path.join(workDir, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  for (const d of fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
    await c.executeMultiple(fs.readFileSync(path.join(MIGRATIONS, d, "migration.sql"), "utf8"));
  }
  c.close();
}
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.SESSION_SECRET = "publication-race-regression-secret-0000";
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = path.join(workDir, "files");
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.LAB_BLOB_READ_WRITE_TOKEN;

const bcrypt = (await import("bcryptjs")).default;
const { prisma } = await import("../src/lib/prisma.js");
const { createApp } = await import("../src/app.js");

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(detail ? `${name} :: ${detail}` : name));

// ---- deterministic interleaving hook ---------------------------------------------------------------------------------------
// The competing change is applied through the SAME transaction (a second connection cannot write while this one holds a read lock),
// so it rolls back together with a refused request. The state the transaction ENDS with is therefore captured inside it, before it
// commits or rolls back: `observed` is what the database would hold once the request is done.
type Hook = (tx: any) => Promise<void>;
type Observed = { member: any | null; audits: number };
let afterRead: Hook | null = null;
let targetId = "";
let observed: Observed | null = null;
const realTransaction = prisma.$transaction.bind(prisma) as (...a: any[]) => Promise<unknown>;
(prisma as unknown as { $transaction: unknown }).$transaction = (...args: any[]) => {
  const hook = afterRead;
  if (!hook || typeof args[0] !== "function") return realTransaction(...args);
  afterRead = null; // one-shot: only the next interactive transaction
  const callback = args[0] as (tx: any) => Promise<unknown>;
  return realTransaction(async (tx: any) => {
    const snapshot = async (): Promise<Observed> => ({
      member: await tx.teamMember.findUnique({ where: { id: targetId } }),
      audits: await tx.auditLog.count({ where: { entityType: "TEAM_MEMBER", entityId: targetId, action: { in: ["TEAM_MEMBER_PUBLISHED", "TEAM_MEMBER_UNPUBLISHED"] } } }),
    });
    const teamMember = new Proxy(tx.teamMember, {
      get(target, prop) {
        if (prop !== "findUnique") return target[prop as string];
        return async (...a: any[]) => {
          const read = await target.findUnique(...a); // what the endpoint saw
          await hook(tx); // ... then the competing change lands before the endpoint writes
          return read;
        };
      },
    });
    try {
      const out = await callback(new Proxy(tx, { get: (target, prop) => (prop === "teamMember" ? teamMember : target[prop as string]) }));
      observed = await snapshot();
      return out;
    } catch (err) {
      observed = await snapshot();
      throw err;
    }
  }, ...args.slice(1));
};

const server = await new Promise<{ base: string; close: () => void }>((resolve) => {
  const s = http.createServer(createApp()).listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() }));
});
class Browser {
  jar = new Map<string, string>();
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(server.base + p, {
      method,
      headers: { "Content-Type": "application/json", Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (pair.slice(i + 1) === "") this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    let json: any = null;
    try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json };
  }
}
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
const mkUser = (email: string, role: string) => prisma.user.create({ data: { email, passwordHash: hash, role } });
const admin = await mkUser("admin@example.org", "ADMIN");
const member = await mkUser("member@example.org", "MEMBER");
const mk = (name: string, category: string, isPublished: boolean, userId: string | null = null) =>
  prisma.teamMember.create({ data: { name, initials: name.slice(0, 2).toUpperCase(), role: "Researcher", category, userId, department: "D", bio: "b", isPublished } as any });
await mk("Admin A", "FACULTY", true, admin.id);
await mk("Member M", "MSC", true, member.id);
const AD = new Browser();
const ME = new Browser();
const GU = new Browser();
t("setup: admin and member sign in", (await AD.req("POST", "/api/auth/login", { email: "admin@example.org", password: PW })).status === 200 && (await ME.req("POST", "/api/auth/login", { email: "member@example.org", password: PW })).status === 200);
const row = (id: string) => prisma.teamMember.findUniqueOrThrow({ where: { id } });
const audits = (id: string) => prisma.auditLog.findMany({ where: { entityType: "TEAM_MEMBER", entityId: id, action: { in: ["TEAM_MEMBER_PUBLISHED", "TEAM_MEMBER_UNPUBLISHED"] } } });
/** Ids a guest can see: the team page (non-alumni) plus the alumni directory. */
const publicIds = async () => [...((await GU.req("GET", "/api/team")).json as any[]), ...((await GU.req("GET", "/api/alumni")).json as any[])].map((m) => m.id);

// ---- ordinary behaviour is unchanged ---------------------------------------------------------------------------------------
const alum = await mk("Alumni One", "ALUMNI", false);
const put = (b: Browser, id: string, isPublished: unknown) => b.req("PUT", `/api/team/${id}/publication`, { isPublished });
t("ordinary: a guest cannot publish (401) and a member cannot (403)", (await put(GU, alum.id, true)).status === 401 && (await put(ME, alum.id, true)).status === 403);
t("ordinary: an unpublished alumnus is not in the public team list", !(await publicIds()).includes(alum.id));
let r: { status: number; json: any } = await put(AD, alum.id, true);
t("ordinary: the admin publishes an alumnus (200) and the row is published", r.status === 200 && (await row(alum.id)).isPublished === true && (await audits(alum.id)).filter((a) => a.action === "TEAM_MEMBER_PUBLISHED").length === 1, `${r.status}`);
t("ordinary: ... and the profile is now publicly listed", (await publicIds()).includes(alum.id));
r = await put(AD, alum.id, true);
t("ordinary: publishing again is a 200 no-op without a second audit row", r.status === 200 && (await audits(alum.id)).length === 1, `${r.status}`);
r = await put(AD, alum.id, false);
t("ordinary: unpublishing (200) hides it and writes one UNPUBLISHED audit row", r.status === 200 && (await row(alum.id)).isPublished === false && !(await publicIds()).includes(alum.id) && (await audits(alum.id)).length === 2, `${r.status}`);
const plain = await mk("Plain Member", "PHD", true);
t("ordinary: a non-alumni profile is refused (409) and unchanged", (await put(AD, plain.id, false)).status === 409 && (await row(plain.id)).isPublished === true);
t("ordinary: an unknown id is 404", (await put(AD, "cjld2cjxh0000qzrmn831i7rn", true)).status === 404);

// ---- the interleaving ------------------------------------------------------------------------------------------------------
const visibleToGuests = (m: any | null) => !!m && m.isPublished === true; // the guest rule (memberVisibility.isMemberVisible), applied to the end state
const race = async (id: string, hook: Hook, want: boolean) => {
  targetId = id;
  observed = null;
  afterRead = hook;
  const res = await put(AD, id, want);
  return { res, end: observed as Observed | null };
};

// A: the category change away from ALUMNI lands between the endpoint's read and its write.
const a = await mk("Race A", "ALUMNI", true);
let x = await race(a.id, (tx) => tx.teamMember.update({ where: { id: a.id }, data: { category: "MSC", isPublished: true } }), false); // what PUT /api/team/:id does for ALUMNI -> MSC
t("race A: the stale 'unpublish' is refused with 409", x.res.status === 409, `${x.res.status} ${JSON.stringify(x.res.json)?.slice(0, 120)}`);
t("race A: the profile is NOT left hidden: it ends as a published non-alumni profile", x.end?.member?.category === "MSC" && x.end?.member?.isPublished === true, JSON.stringify(x.end?.member && { c: x.end.member.category, p: x.end.member.isPublished }));
t("race A: ... which guests can see", visibleToGuests(x.end?.member));
t("race A: no PUBLISHED/UNPUBLISHED audit row for the refused write", x.end?.audits === 0, String(x.end?.audits));

// B: a competing publication change lands between read and write: the request must not silently overwrite it with a stale decision.
const b = await mk("Race B", "ALUMNI", false);
x = await race(b.id, (tx) => tx.teamMember.update({ where: { id: b.id }, data: { isPublished: true } }), false); // another admin published in between; this request read 'false'
t("race B: a write based on a stale publication state is refused (409), not applied over the newer state", x.res.status === 409 && x.end?.member?.isPublished === true, `${x.res.status} ${x.end?.member?.isPublished}`);
t("race B: ... and nothing was audited for it", x.end?.audits === 0);
// the refused request left nothing behind (the competing change was part of the rolled-back transaction); a retry without interference applies
t("race B: after the refusal the stored state is untouched", (await row(b.id)).isPublished === false);
r = await put(AD, b.id, true);
t("race B: a clean retry applies and is audited once", r.status === 200 && (await row(b.id)).isPublished === true && (await audits(b.id)).length === 1, `${r.status}`);

// C: the profile went ALUMNI -> non-alumni -> ALUMNI (consent reset to unpublished) between read and write.
const c = await mk("Race C", "ALUMNI", true);
x = await race(c.id, async (tx) => {
  await tx.teamMember.update({ where: { id: c.id }, data: { category: "MSC", isPublished: true } });
  await tx.teamMember.update({ where: { id: c.id }, data: { category: "ALUMNI", isPublished: false } });
}, true); // read: ALUMNI + published; intent: publish
t("race C: a stale request cannot publish a profile whose consent was reset meanwhile (409; it ends unpublished)", x.res.status === 409 && x.end?.member?.isPublished === false && x.end?.member?.category === "ALUMNI", `${x.res.status} ${x.end?.member?.isPublished}`);
t("race C: ... and is not visible to guests", !visibleToGuests(x.end?.member));

// D: the profile was deleted between read and write.
const d = await mk("Race D", "ALUMNI", true);
x = await race(d.id, async (tx) => { await tx.teamMember.delete({ where: { id: d.id } }); }, false);
t("race D: deleted between read and write -> refused (409 or 404), nothing re-created, no audit", (x.res.status === 409 || x.res.status === 404) && x.end?.member === null && x.end?.audits === 0, `${x.res.status}`);
t("race D: the refused request rolled the competing delete back with it (the stored row still exists)", (await prisma.teamMember.count({ where: { id: d.id } })) === 1);

// ---- hidden profiles remain excluded from public surfaces ------------------------------------------------------------------
t("surfaces: the unpublished alumnus stays out of the guest lists", !(await publicIds()).includes(alum.id));

server.close();
await prisma.$disconnect();
console.log(`${ok} publication-race checks passed, ${failures.length} failed.`);
for (const f of failures) console.log(`  FAIL  ${f}`);
fs.rmSync(workDir, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);

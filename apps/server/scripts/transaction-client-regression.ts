/**
 * Regression: a query issued on the SHARED Prisma client from inside an interactive transaction waits for the connection (and, with the
 * libsql adapter, the mutex) that the transaction itself holds, so the request stalls until Prisma's transaction timeout (5 s) and then
 * fails with 500 (P2028). Two handlers did that:
 *   - PUT /api/knowledge/:id when a link (project / area / group / researcher) is changed   (assertLinks)
 *   - PUT /api/admin/translations/:entityType/:entityId                                     (def.find existence check)
 * and, found later by running the browser sweep under a single connection and confirmed by an AST scan of every $transaction callback:
 *   - PUT /api/resources/:id when a link or a project is added                              (assertLinks)
 *   - PUT /api/events/:id when the event is linked to a project                              (assertMayLinkProject)
 * They only worked when the pool happened to have a second connection. This script runs the REAL application on a brand-new SQLite file
 * built from the repository's migrations, with the database URL forced to `?connection_limit=1`, and requires every request to answer
 * correctly AND quickly (well under the 5 s timeout). Authorization and validation outcomes are asserted inside the same transactions.
 *
 * What it proves: with a single connection these code paths no longer wait on themselves. What it does NOT prove: remote Turso behaviour
 * (see docs/architecture/phase3-release-runbook.md, scenario 13). Uses no hosted database; refuses to run if TURSO_* is set.
 *   npx tsx scripts/transaction-client-regression.ts   (or: npm run test:transaction-client -w apps/server)
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scl-txclient-"));
const dbFile = path.join(workDir, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  for (const d of fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
    await c.executeMultiple(fs.readFileSync(path.join(MIGRATIONS, d, "migration.sql"), "utf8"));
  }
  c.close();
}
const CONNECTION_LIMIT = process.env.TX_CLIENT_CONNECTION_LIMIT ?? "1";
process.env.DATABASE_URL = `file:${dbFile}?connection_limit=${CONNECTION_LIMIT}`;
process.env.SESSION_SECRET = "transaction-client-regression-secret-0000";
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = path.join(workDir, "files");
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.LAB_BLOB_READ_WRITE_TOKEN;

const logged: string[] = [];
const realError = console.error;
console.error = (...a: unknown[]) => void logged.push(a.map((x) => (typeof x === "string" ? x : `<<${typeof x}>>`)).join(" "));

const bcrypt = (await import("bcryptjs")).default;
const { prisma } = await import("../src/lib/prisma.js");
const { createApp } = await import("../src/app.js");

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(detail ? `${name} :: ${detail}` : name));

const server = await new Promise<{ base: string; close: () => void }>((resolve) => {
  const s = http.createServer(createApp()).listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() }));
});
/** A request must finish well inside Prisma's 5 s interactive-transaction timeout; a self-waiting handler would take >= 5 s. */
const FAST_MS = 2500;
class Browser {
  jar = new Map<string, string>();
  async req(method: string, p: string, body?: unknown) {
    const started = Date.now();
    const res = await fetch(server.base + p, {
      method,
      headers: { "Content-Type": "application/json", Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (pair.slice(i + 1) === "") this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    let json: any = null;
    try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json, ms: Date.now() - started };
  }
}
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
const mkUser = (email: string, role: string) => prisma.user.create({ data: { email, passwordHash: hash, role } });
const admin = await mkUser("admin@example.org", "ADMIN");
const author = await mkUser("author@example.org", "MEMBER");
const other = await mkUser("other@example.org", "MEMBER");
const mkMember = (name: string, userId: string | null, category: string, isPublished = true) =>
  prisma.teamMember.create({ data: { name, initials: name.slice(0, 2).toUpperCase(), role: "Researcher", category, userId, department: "D", bio: "b", isPublished } as any });
await mkMember("Admin A", admin.id, "FACULTY");
await mkMember("Author A", author.id, "MSC");
await mkMember("Other O", other.id, "MSC");
const researcher = await mkMember("Visible Researcher", null, "MSC");
const hiddenResearcher = await mkMember("Hidden Alumni", null, "ALUMNI", false);
const projPub = await prisma.researchProject.create({ data: { slug: "tx-proj-pub", title: "Public project", visibility: "PUBLIC" } });
const projPriv = await prisma.researchProject.create({ data: { slug: "tx-proj-priv", title: "Private project", visibility: "PRIVATE" } });
const area = await prisma.researchArea.create({ data: { title: "Area", description: "d", tag: "tx", visibility: "PUBLIC" } });
const group = await prisma.researchGroup.create({ data: { slug: "tx-grp", name: "Group", visibility: "PUBLIC" } });

const AD = new Browser();
const AU = new Browser();
const OT = new Browser();
for (const [b, e] of [[AD, "admin"], [AU, "author"], [OT, "other"]] as const) {
  const r = await b.req("POST", "/api/auth/login", { email: `${e}@example.org`, password: PW });
  t(`setup: ${e} signs in`, r.status === 200, String(r.status));
}
t("setup: the server really runs with a single connection", process.env.DATABASE_URL!.includes(`connection_limit=${CONNECTION_LIMIT}`));

// ---- PUT /api/knowledge/:id: every link branch of assertLinks runs inside the update transaction -----------------------------
const created = await AU.req("POST", "/api/knowledge", { title: "Doc", body: "body" });
t("knowledge: create (assertLinks outside a transaction) answers 201", created.status === 201, String(created.status));
const docId: string = created.json?.id;
const put = (b: Browser, body: unknown) => b.req("PUT", `/api/knowledge/${docId}`, body);

let r = await put(AU, { projectId: projPub.id });
t("knowledge PUT: linking a visible project answers 200 promptly", r.status === 200 && r.json?.project?.id === projPub.id && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
r = await put(AU, { researchAreaId: area.id, groupId: group.id });
t("knowledge PUT: linking an area and a group answers 200 promptly", r.status === 200 && r.json?.group?.id === group.id && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
r = await put(AU, { teamMemberId: researcher.id });
t("knowledge PUT: linking a visible researcher answers 200 promptly", r.status === 200 && r.json?.researcher?.id === researcher.id && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
r = await put(AU, { projectId: null });
t("knowledge PUT: clearing a link answers 200 promptly", r.status === 200 && r.json?.project === null && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
r = await put(AU, { projectId: projPriv.id });
t("knowledge PUT: a PRIVATE project is refused (400) inside the transaction, promptly", r.status === 400 && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
r = await put(AU, { teamMemberId: hiddenResearcher.id });
t("knowledge PUT: an unpublished (alumni) researcher is refused (400) exactly like a missing one, promptly", r.status === 400 && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
const missing = await put(AU, { teamMemberId: "cjld2cjxh0000qzrmn831i7rn" });
t("knowledge PUT: ...and the answer is identical to a nonexistent researcher (no enumeration)", missing.status === 400 && JSON.stringify(missing.json) === JSON.stringify(r.json), JSON.stringify([missing.json, r.json]));
r = await put(OT, { projectId: projPub.id });
t("knowledge PUT: a non-author member is still 403, promptly", r.status === 403 && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
const row = await prisma.knowledgeDoc.findUniqueOrThrow({ where: { id: docId } });
t("knowledge PUT: the refused requests left the stored links untouched (atomic)", row.projectId === null && row.teamMemberId === researcher.id && row.groupId === group.id);

// ---- PUT /api/admin/translations/:entityType/:entityId: def.find runs inside the transaction -----------------------------------
const tr = (field: string, value: string | null, type = "KNOWLEDGE_DOC", id = docId) => AD.req("PUT", `/api/admin/translations/${type}/${id}`, { field, value });
r = await tr("title", "日本語タイトル");
t("translations PUT: setting an override answers 200 promptly", r.status === 200 && r.ms < FAST_MS, `${r.status} ${r.ms}ms ${JSON.stringify(r.json)}`);
let overrides = await prisma.translation.findMany({ where: { entityType: "KNOWLEDGE_DOC", entityId: docId } });
t("translations PUT: the override is stored", overrides.length === 1 && overrides[0].value === "日本語タイトル");
const audit = await prisma.auditLog.findFirst({ where: { entityType: "KNOWLEDGE_DOC", entityId: docId, action: "TRANSLATIONS_CHANGED" } });
t("translations PUT: audited with field names only", !!audit && !(audit.details ?? "").includes("日本語"));
r = await tr("title", null);
overrides = await prisma.translation.findMany({ where: { entityType: "KNOWLEDGE_DOC", entityId: docId } });
t("translations PUT: clearing the override answers 200 promptly and removes it", r.status === 200 && r.ms < FAST_MS && overrides.length === 0, `${r.status} ${r.ms}ms`);
r = await tr("title", "x", "KNOWLEDGE_DOC", "cjld2cjxh0000qzrmn831i7rn");
t("translations PUT: an unknown entity id is 404 promptly (existence check inside the transaction)", r.status === 404 && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
r = await tr("secret", "x");
t("translations PUT: a non-translatable field is 400", r.status === 400);
r = await OT.req("PUT", `/api/admin/translations/KNOWLEDGE_DOC/${docId}`, { field: "title", value: "x" });
t("translations PUT: a plain member is 403", r.status === 403);
// the same handler for a second entity type exercises another def.find
r = await tr("name", "チーム", "RESEARCH_GROUP", group.id);
t("translations PUT: another entity type (research group) also answers promptly", r.status === 200 && r.ms < FAST_MS, `${r.status} ${r.ms}ms ${JSON.stringify(r.json)}`);

// ---- PUT /api/resources/:id: assertLinks runs inside the update transaction ---------------------------------------------------
const mkRes = await AU.req("POST", "/api/resources", { name: "Tx resource", resourceType: "TOOL" });
t("resources: create (assertLinks outside a transaction) answers 201", mkRes.status === 201, `${mkRes.status} ${JSON.stringify(mkRes.json)}`);
const resId: string = mkRes.json?.id;
const putRes = (b: Browser, body: unknown) => b.req("PUT", `/api/resources/${resId}`, body);
r = await putRes(AU, { researchAreaId: area.id, groupId: group.id });
t("resources PUT: linking a visible area and group answers 200 promptly", r.status === 200 && r.ms < FAST_MS, `${r.status} ${r.ms}ms ${r.status === 200 ? "" : JSON.stringify(r.json)}`);
r = await putRes(AU, { projectIds: [projPub.id] });
t("resources PUT: adding a visible project answers 200 promptly", r.status === 200 && r.ms < FAST_MS, `${r.status} ${r.ms}ms ${r.status === 200 ? "" : JSON.stringify(r.json)}`);
r = await putRes(AU, { projectIds: [projPub.id, projPriv.id] });
t("resources PUT: a PRIVATE project is refused (400) inside the transaction, promptly", r.status === 400 && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
r = await putRes(AU, { researchAreaId: "cjld2cjxh0000qzrmn831i7rn" });
t("resources PUT: an unknown area is refused (400) inside the transaction, promptly", r.status === 400 && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
r = await putRes(OT, { researchAreaId: area.id });
t("resources PUT: a non-owner member is still 403, promptly", r.status === 403 && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
const resRow = await prisma.labResource.findUniqueOrThrow({ where: { id: resId }, include: { projectLinks: true } });
t("resources PUT: the refused requests left the stored links untouched (atomic)", resRow.researchAreaId === area.id && resRow.groupId === group.id && resRow.projectLinks.length === 1 && resRow.projectLinks[0].projectId === projPub.id);

// ---- PUT /api/events/:id: assertMayLinkProject runs inside the update transaction ---------------------------------------------------
const mkEv = await AD.req("POST", "/api/events", { title: "Tx event", startsAt: "2032-05-01T10:00:00.000Z" });
t("events: create answers 201", mkEv.status === 201, `${mkEv.status} ${JSON.stringify(mkEv.json)}`);
const evId: string = mkEv.json?.id;
const putEv = (b: Browser, body: unknown) => b.req("PUT", `/api/events/${evId}`, body);
r = await putEv(AD, { projectId: projPub.id });
t("events PUT: linking an existing project answers 200 promptly", r.status === 200 && r.ms < FAST_MS, `${r.status} ${r.ms}ms ${r.status === 200 ? "" : JSON.stringify(r.json)}`);
r = await putEv(AD, { projectId: "cjld2cjxh0000qzrmn831i7rn" });
t("events PUT: an unknown project is refused (400) inside the transaction, promptly", r.status === 400 && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
r = await putEv(OT, { projectId: projPub.id });
t("events PUT: a plain member is still refused, promptly", (r.status === 403 || r.status === 404) && r.ms < FAST_MS, `${r.status} ${r.ms}ms`);
const evRow = await prisma.event.findUniqueOrThrow({ where: { id: evId } });
t("events PUT: the refused requests left the stored link untouched (atomic)", evRow.projectId === projPub.id);

t("no request in this run timed out inside Prisma (no P2028 / expired-transaction message was logged)", !logged.some((l) => /P2028|expired transaction|Transaction already closed/i.test(l)), logged.filter((l) => /P2028|expired|closed/i.test(l)).slice(0, 2).join(" | "));

server.close();
await prisma.$disconnect();
console.error = realError;
console.log(`[connection_limit=${CONNECTION_LIMIT}] ${ok} transaction-client checks passed, ${failures.length} failed.`);
for (const f of failures) console.log(`  FAIL  ${f}`);
fs.rmSync(workDir, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);

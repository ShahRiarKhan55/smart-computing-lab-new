/**
 * Diagnostic (not a pass/fail gate): how the embedded-libSQL guard's synchronous busy-wait interacts with Prisma's interactive
 * transaction limits. NOTE: the server it starts uses an embedded `file:` URL, so the five profile-photo write routes run with the WIDER embedded limits (`timeout` 15 s, `maxWait` 8 s, see `interactiveTransactionOptions`); Prisma's defaults (5 s / 2 s) apply to every other transaction. The 5 s default is only exercised, scaled down, by scripts/profile-photo-expiry-probe.ts. It starts ONE server process (embedded libSQL file
 * through the real `lib/prisma.ts` + guard), makes another process hold locks on the file for several seconds, then sends real requests
 * and records: status and latency, whether the process's event loop was blocked (health pings), what the server logged, whether any
 * lock or half-open transaction remained afterwards, and whether the data stayed consistent (photo references, blobs).
 *
 *   npx tsx scripts/profile-photo-stall-probe.ts
 *
 * DISPOSABLE LOCAL DATABASE ONLY: temp directory, `file:` URL, explicit minimal child environment, placeholder token; it refuses to run
 * when TURSO_*, DATABASE_URL or apps/server/.env exist. It never talks to a remote Turso/libSQL server.
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import * as F from "./imageFixtures.ts";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_URL) { console.error("Refusing to run: TURSO_* / DATABASE_URL is set."); process.exit(2); }
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (fs.existsSync(path.join(SERVER, ".env"))) { console.error("Refusing to run: apps/server/.env exists."); process.exit(2); }
const PORT = 4121;
if (await new Promise<boolean>((res) => { const s = net.connect(PORT, "127.0.0.1", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); })) { console.error(`Port ${PORT} in use.`); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), "scl-photo-stall-"));
const dbUrl = `file:${path.join(work, "t.db")}`;
const storageDir = path.join(work, "files");
{
  const c = createClient({ url: dbUrl });
  const mig = path.join(SERVER, "prisma", "migrations");
  for (const d of fs.readdirSync(mig, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) await c.executeMultiple(fs.readFileSync(path.join(mig, d, "migration.sql"), "utf8"));
  c.close();
}
let server: ChildProcess | null = null;
const serverLog: string[] = [];
function startServer() {
  server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: SERVER, stdio: ["ignore", "ignore", "pipe"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "development", PORT: String(PORT), DATABASE_URL: dbUrl, TURSO_DATABASE_URL: dbUrl, TURSO_AUTH_TOKEN: "local-embedded-placeholder-not-a-credential", STORAGE_DIR: storageDir, SESSION_SECRET: "profile-photo-stall-probe-secret-0000", ...(process.env.PROBE_DEBUG ? { DEBUG: "prisma:driver-adapter:libsql" } : {}) },
  });
  server.stderr!.on("data", (d) => serverLog.push(String(d)));
}
const base = `http://127.0.0.1:${PORT}`;
async function waitUp() { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/health")).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error("server did not start"); }
startServer();
await waitUp();
const stop = () => { try { server?.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", stop);

process.env.DATABASE_URL = dbUrl;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = (await import("bcryptjs")).default;
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  jar = new Map<string, string>();
  async req(method: string, p: string, body?: BodyInit, headers: Record<string, string> = {}) {
    const t0 = Date.now();
    try {
      const res = await fetch(base + p, { method, redirect: "manual", headers: { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...headers }, body });
      for (const c of res.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); this.jar.set(pair.slice(0, i), pair.slice(i + 1)); }
      const buf = Buffer.from(await res.arrayBuffer());
      let json: any = null; try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
      return { status: res.status, ms: Date.now() - t0, json, retryAfter: res.headers.get("retry-after") };
    } catch (e) { return { status: 0, ms: Date.now() - t0, json: null, retryAfter: null as string | null, error: String(e) }; }
  }
  login = (email: string) => this.req("POST", "/api/auth/login", JSON.stringify({ email, password: PW }), { "Content-Type": "application/json" });
  put = (b: object) => this.req("PUT", "/api/profile", JSON.stringify(b), { "Content-Type": "application/json" });
  upload(bytes: Buffer) { const fd = new FormData(); fd.append("file", new Blob([bytes], { type: "image/png" }), "p.png"); return this.req("POST", "/api/profile/photo", fd); }
}
let n = 0;
async function account() {
  n++;
  const user = await prisma.user.create({ data: { email: `s${n}-${crypto.randomUUID().slice(0, 6)}@example.org`, passwordHash: hash, role: "MEMBER" } });
  const member = await prisma.teamMember.create({ data: { name: `Member ${n}`, initials: "MM", role: "R", category: "MSC", userId: user.id, photoUrl: "", department: "D", bio: "B0" } });
  const c = new Client();
  if ((await c.login(user.email)).status !== 200) throw new Error("login failed");
  return { user, member, c };
}

// ---- lock holders: separate short-lived processes -----------------------------------------------------------------------------
const HOLDER = `
const { createClient } = require("@libsql/client");
(async () => {
  const [url, kind, ms, delay] = process.argv.slice(1);
  const c = createClient({ url });
  await new Promise((r) => setTimeout(r, Number(delay)));
  const tx = await c.transaction(kind === "write" ? "write" : "deferred");
  if (kind === "write") await tx.execute("UPDATE TeamMember SET sortOrder = sortOrder WHERE 0"); else await tx.execute("SELECT * FROM TeamMember");
  console.log("held");
  setTimeout(async () => { try { await tx.rollback(); } catch {} process.exit(0); }, Number(ms));
})();`;
function hold(kind: "read" | "write", ms: number, delayMs = 0): { ready: Promise<void>; done: Promise<void> } {
  const p = spawn(process.execPath, ["-e", HOLDER, dbUrl, kind, String(ms), String(delayMs)], { cwd: SERVER, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "inherit"] });
  const done = new Promise<void>((r) => p.on("exit", () => r()));
  const ready = new Promise<void>((r) => p.stdout!.once("data", () => r()));
  return { ready, done };
}
const PROBE = `const { createClient } = require("@libsql/client");(async()=>{const c=createClient({url:process.argv[1]});try{await c.execute("CREATE TABLE IF NOT EXISTS _p (x INTEGER)");await c.execute("BEGIN IMMEDIATE");await c.execute("INSERT INTO _p VALUES (1)");await c.execute("COMMIT");process.exit(0)}catch{process.exit(1)}})()`;
const lockFree = () => new Promise<boolean>((res) => { const p = spawn(process.execPath, ["-e", PROBE, dbUrl], { cwd: SERVER, env: { PATH: process.env.PATH }, stdio: "ignore" }); p.on("exit", (c) => res(c === 0)); });
async function lockFreeWithin(ms: number) { const end = Date.now() + ms; for (;;) { if (await lockFree()) return true; if (Date.now() > end) return false; await sleep(300); } }

/** Pings /api/health while `fn` runs; returns the longest gap between completed pings (the event-loop stall seen from outside). */
async function withHealth<T>(fn: () => Promise<T>) {
  let stop = false; let worst = 0; let last = Date.now();
  const loop = (async () => { while (!stop) { try { await fetch(base + "/api/health"); } catch { /* blocked */ } const now = Date.now(); worst = Math.max(worst, now - last); last = now; await sleep(150); } })();
  const out = await fn(); stop = true; await loop;
  return { out, worstGapMs: worst };
}
const blobOf = (key: string) => fs.existsSync(path.join(storageDir, key));
async function consistency() {
  const problems: string[] = [];
  for (const m of await prisma.teamMember.findMany()) {
    if (!m.photoUrl.startsWith("/api/files/")) continue;
    const f = await prisma.storedFile.findUnique({ where: { id: m.photoUrl.split("/").pop()! } });
    if (!f || f.deletedAt) problems.push(`${m.name} references a missing/retired file`); else if (!blobOf(f.storageKey)) problems.push(`${m.name}'s file has no blob`);
  }
  for (const f of await prisma.storedFile.findMany({ where: { deletedAt: null } })) if (!blobOf(f.storageKey)) problems.push(`live file ${f.id} has no blob`);
  const refd = new Set((await prisma.teamMember.findMany()).map((m) => m.photoUrl));
  for (const f of await prisma.storedFile.findMany({ where: { entityType: "TEAM_MEMBER", deletedAt: null } })) if (!refd.has(`/api/files/${f.id}`)) problems.push(`live unreferenced photo file ${f.id}`);
  const keys = new Set((await prisma.storedFile.findMany({ select: { storageKey: true } })).map((r) => r.storageKey));
  const orphans = (fs.existsSync(storageDir) ? fs.readdirSync(storageDir) : []).filter((k) => !keys.has(k)).length;
  return { problems, orphans };
}

type Row = { scenario: string; result: string };
const rows: Row[] = [];
const png = (s: number) => F.pngFile({ w: 60 + (s % 7), h: 40 });
async function scenario(name: string, run: () => Promise<string>) {
  if (process.env.ONLY_SCENARIO && !name.startsWith(process.env.ONLY_SCENARIO)) return;
  serverLog.length = 0;
  console.error(`[probe] ${name} ...`);
  const result = await run();
  console.error(`[probe]   done: ${result.slice(0, 160)}`);
  const free = await lockFreeWithin(12000);
  const alive = await fetch(base + "/api/health").then((r) => r.ok).catch(() => false);
  const post = await consistency();
  const errs = [...new Set(serverLog.join("").split("\n").filter((l) => /P20\d\d|P10\d\d|SQLITE|Transaction|transaction|timed out|Timed out|locked/.test(l)).map((l) => l.trim().slice(0, 150)))].slice(0, 4);
  if (process.env.PROBE_DEBUG) console.error(serverLog.join("").split("\n").filter((l) => /js::(commit|rollback|startTransaction)|"sql"/.test(l)).map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 150)).join("\n"));
  rows.push({ scenario: name, result: `${result} | lock free afterwards: ${free} | server answers: ${alive} | consistency problems: ${post.problems.length ? post.problems.join("; ") : "none"} | unreferenced blobs: ${post.orphans} | server log: ${errs.join(" // ") || "-"}` });
  if (!free) { stop(); await sleep(800); startServer(); await waitUp(); rows.push({ scenario: `${name} (recovery)`, result: `lock released only by restarting the server process: ${await lockFree()}` }); }
}

// S1: a reader in another process holds a read lock for 9 s; a profile save (write-first) must COMMIT through it.
await scenario("S1 text save while another process holds a READ lock for 9 s (commit must wait)", async () => {
  const a = await account();
  const r = hold("read", 9000); await r.ready;
  const { out, worstGapMs } = await withHealth(() => a.c.put({ bio: "stalled save" }));
  await r.done;
  const bio = (await prisma.teamMember.findUnique({ where: { id: a.member.id } }))!.bio;
  return `status ${out.status} after ${out.ms} ms (retry-after ${out.retryAfter}); longest event-loop gap seen by health pings ${worstGapMs} ms; bio in DB "${bio}" (${out.status === 200 ? (bio === "stalled save" ? "applied as reported" : "MISMATCH") : bio === "B0" ? "not applied, as reported" : "APPLIED DESPITE ERROR (uncertain outcome)"})`;
});

// S2: the ~6 s path: another process holds the WRITE lock for ~1.8 s (first write waits) and a reader holds a read lock for 9 s (commit waits).
await scenario("S2 first write waits ~1.8 s for another writer, then the commit waits on a 9 s reader (worst path, ~6 s)", async () => {
  const a = await account();
  const r = hold("read", 9000); await r.ready;
  const w = hold("write", 1800); await w.ready;
  const { out, worstGapMs } = await withHealth(() => a.c.put({ bio: "six second save" }));
  await Promise.all([r.done, w.done]);
  const bio = (await prisma.teamMember.findUnique({ where: { id: a.member.id } }))!.bio;
  return `status ${out.status} after ${out.ms} ms; longest event-loop gap ${worstGapMs} ms; bio in DB "${bio}" (${out.status === 200 ? (bio === "six second save" ? "applied as reported" : "MISMATCH") : bio === "B0" ? "not applied, as reported" : "APPLIED DESPITE ERROR (uncertain outcome)"})`;
});

// S3: knock-on: other requests to the SAME process while one is stalled in a commit.
await scenario("S3 knock-on: 3 more saves from other members arrive while one commit is stalled", async () => {
  const a = await account(); const others = [await account(), await account(), await account()];
  const r = hold("read", 9000); await r.ready;
  const first = a.c.put({ bio: "stalled" });
  await sleep(300);
  const rest = others.map((o, i) => o.c.put({ bio: `other ${i}` }));
  const res = await Promise.all([first, ...rest]);
  await r.done;
  const bios = await Promise.all([a, ...others].map(async (o) => (await prisma.teamMember.findUnique({ where: { id: o.member.id } }))!.bio));
  return `statuses+latency ${res.map((x) => `${x.status}/${x.ms}ms`).join(", ")}; bios in DB ${JSON.stringify(bios)}`;
});

// S4: a photo upload whose commit stalls.
await scenario("S4 photo upload while another process holds a READ lock for 9 s", async () => {
  const a = await account();
  const r = hold("read", 9000); await r.ready;
  const out = await a.c.upload(png(2));
  await r.done;
  const m = (await prisma.teamMember.findUnique({ where: { id: a.member.id } }))!;
  return `status ${out.status} after ${out.ms} ms; member.photoUrl ${m.photoUrl ? "set" : "empty"} (${out.status === 201 ? (m.photoUrl ? "applied as reported" : "MISMATCH") : m.photoUrl ? "APPLIED DESPITE ERROR (uncertain outcome)" : "not applied, as reported"})`;
});

// S6: the lock clears (about 5.7 s after the request started) AFTER the guard has already given up (first write ~1.8 s + commit budget 2 s).
// This is a control for "late release": it cannot make the commit succeed late, so it does not exercise Prisma's transaction expiry (see
// scripts/profile-photo-expiry-probe.ts for that).
await scenario("S6 locks clear late: first write waits ~1.8 s, the reader leaves ~5.7 s after the request started", async () => {
  const a = await account();
  const r = hold("read", Number(process.env.LATE_HOLD_MS ?? 5700)); await r.ready;
  const w = hold("write", 1800); await w.ready;
  const { out } = await withHealth(() => a.c.put({ bio: "late commit" }));
  await Promise.all([r.done, w.done]);
  const bio = (await prisma.teamMember.findUnique({ where: { id: a.member.id } }))!.bio;
  return `status ${out.status} after ${out.ms} ms; bio in DB "${bio}" (${out.status === 200 ? (bio === "late commit" ? "applied as reported" : "MISMATCH") : bio === "B0" ? "not applied, as reported" : "APPLIED DESPITE ERROR (uncertain outcome)"})`;
});

// S7: the same control for a photo upload (is a blob or row left in a state the safeguards do not cover after a failed commit?).
await scenario("S7 late release (first write ~1.8 s, reader leaves ~5.7 s) for a PHOTO UPLOAD", async () => {
  const a = await account();
  const r = hold("read", Number(process.env.LATE_HOLD_MS ?? 5700)); await r.ready;
  const w = hold("write", 1800); await w.ready;
  const out = await a.c.upload(png(3));
  await Promise.all([r.done, w.done]);
  const m = (await prisma.teamMember.findUnique({ where: { id: a.member.id } }))!;
  return `status ${out.status} after ${out.ms} ms; member.photoUrl ${m.photoUrl ? "set" : "empty"} (${out.status === 201 ? (m.photoUrl ? "applied as reported" : "MISMATCH") : m.photoUrl ? "APPLIED DESPITE ERROR (uncertain outcome)" : "not applied, as reported"})`;
});

// S8: the FIRST write itself times out (another process holds the write lock for 3.5 s, longer than the 2 s busy timeout). A statement-level
// BUSY is the one failure the guard cannot repair, so check what it leaves behind.
await scenario("S8 first write times out: another process holds the WRITE lock for 3.5 s", async () => {
  const a = await account();
  const w = hold("write", 3500); await w.ready;
  const out = await a.c.put({ bio: "first write times out" });
  await w.done;
  const bio = (await prisma.teamMember.findUnique({ where: { id: a.member.id } }))!.bio;
  const after = await a.c.put({ bio: "after the stall" });
  return `status ${out.status} after ${out.ms} ms (retry-after ${out.retryAfter}); bio in DB "${bio}"; the next request from the same member answers ${after.status}`;
});

// S5: short stall, for contrast (reader holds 1 s: commit should simply wait and succeed).
await scenario("S5 contrast: reader holds a read lock for 1 s", async () => {
  const a = await account();
  const r = hold("read", 1000); await r.ready;
  const out = await a.c.put({ bio: "short wait" });
  await r.done;
  return `status ${out.status} after ${out.ms} ms`;
});

stop(); await sleep(500);
await prisma.$disconnect().catch(() => {});
if (process.env.KEEP_WORKDIR !== "1") fs.rmSync(work, { recursive: true, force: true });
console.log("profile-photo stall probe (embedded libSQL file, guard on; the profile-photo write routes run with the wider embedded transaction limits: timeout 15000 ms, maxWait 8000 ms)");
for (const r of rows) console.log(`\n- ${r.scenario}\n    ${r.result}`);

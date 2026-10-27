/**
 * Concurrency check of the profile-photo lifecycle (upload, profile PUT, team PUT/DELETE, generic file DELETE) against DISPOSABLE
 * LOCAL databases only. It asserts INVARIANTS after each round of simultaneous requests, not which request wins.
 *
 *   npx tsx scripts/profile-photo-concurrency.ts <engine> <topology> [rounds]
 *     engine    sqlite : plain Prisma on a SQLite file (the local/test topology)
 *               libsql : the SAME driver adapter the hosted deployment uses (@prisma/adapter-libsql over @libsql/client), pointed at an
 *                        EMBEDDED libSQL database file in a temp directory (a `file:` URL: no network, no token, no hosted service)
 *     topology  same  : every request goes to one server process
 *               cross : requests alternate between TWO server processes that share the database file (the multi-instance case;
 *                       the adapter's in-process transaction lock cannot serialize across processes)
 *
 * WHAT THIS DOES NOT PROVE. It does not talk to a remote Turso/libSQL server (sqld), whose lock and busy behaviour can differ from an
 * embedded file; behaviour there is unverified. Nothing here reads or sets a real credential: the children get an explicit, minimal
 * environment, and the libSQL variant is given a placeholder token that no service would accept. The script refuses to run when
 * TURSO_* variables are present in its own environment or when apps/server/.env exists (so no ambient configuration can leak in).
 *
 * Debugging aids (environment variables): ONLY_SCENARIO=<substring of a scenario name>; KEEP_WORKDIR=1; NO_PHOTO_FEATURE=1 together with
 * ONLY_SCENARIO=control runs the control scenario against code that predates the photo endpoint (the other scenarios need it).
 * The npm script is NOT a CI gate: it is randomized, slow, and only exercises embedded files (never a remote Turso/libSQL server).
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

const [engineArg, topologyArg, roundsArg] = process.argv.slice(2);
const engine = engineArg as "sqlite" | "libsql";
const topology = topologyArg as "same" | "cross";
const ROUNDS = Number(roundsArg) || 10;
if (!["sqlite", "libsql"].includes(engine) || !["same", "cross"].includes(topology)) {
  console.error("usage: profile-photo-concurrency.ts <sqlite|libsql> <same|cross> [rounds]");
  process.exit(2);
}
if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_URL) {
  console.error("Refusing to run: TURSO_* / DATABASE_URL is set in this environment.");
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..");
if (fs.existsSync(path.join(SERVER, ".env"))) {
  console.error("Refusing to run: apps/server/.env exists (the server would load it).");
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), `scl-photo-conc-${engine}-${topology}-`));
const dbFile = path.join(work, "t.db");
const storageDir = path.join(work, "files");
const dbUrl = `file:${dbFile}`;
{
  const c = createClient({ url: dbUrl });
  const mig = path.join(SERVER, "prisma", "migrations");
  for (const d of fs.readdirSync(mig, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) await c.executeMultiple(fs.readFileSync(path.join(mig, d, "migration.sql"), "utf8"));
  c.close();
}

// ---- the application instances (own processes, explicit minimal environment) ----------------------------------------------
const PORTS = topology === "cross" ? [4111, 4112] : [4111];
const isBusy = (port: number) => new Promise<boolean>((res) => { const s = net.connect(port, "127.0.0.1", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
for (const p of PORTS) if (await isBusy(p)) { console.error(`Port ${p} is in use; refusing to run.`); fs.rmSync(work, { recursive: true, force: true }); process.exit(2); }
const children: ChildProcess[] = [];
const stderrLines: string[] = [];
const baseEnv = (port: number): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "development", PORT: String(port),
  DATABASE_URL: dbUrl, STORAGE_DIR: storageDir, SESSION_SECRET: "profile-photo-concurrency-secret-000000",
  ...(engine === "libsql" ? { TURSO_DATABASE_URL: dbUrl, TURSO_AUTH_TOKEN: "local-embedded-placeholder-not-a-credential" } : {}),
});
function startInstance(i: number) {
  const c = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: SERVER, env: baseEnv(PORTS[i]), stdio: ["ignore", "ignore", "pipe"] });
  c.stderr!.on("data", (d) => stderrLines.push(String(d)));
  children[i] = c;
}
for (let i = 0; i < PORTS.length; i++) startInstance(i);
const stopAll = () => { for (const c of children) { try { c.kill("SIGTERM"); } catch { /* gone */ } } };
process.on("exit", stopAll);
const bases = PORTS.map((p) => `http://127.0.0.1:${p}`);
async function waitUp() {
  for (const b of bases) {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(b + "/api/health")).ok; } catch { /* starting */ } if (!up) await new Promise((r) => setTimeout(r, 500)); }
    if (!up) { console.error("server did not start"); stopAll(); fs.rmSync(work, { recursive: true, force: true }); process.exit(2); }
  }
}
await waitUp();

// ---- the parent's own (plain SQLite) client: setup and read-only invariant checks, only while the servers are idle -------------
process.env.DATABASE_URL = dbUrl;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = (await import("bcryptjs")).default;
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);

class Client {
  jar = new Map<string, string>();
  constructor(public base: string) {}
  async req(method: string, p: string, body?: BodyInit, headers: Record<string, string> = {}) {
    try {
      const res = await fetch(this.base + p, { method, redirect: "manual", headers: { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...headers }, body });
      for (const c of res.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); this.jar.set(pair.slice(0, i), pair.slice(i + 1)); }
      const buf = Buffer.from(await res.arrayBuffer());
      let json: any = null;
      try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
      return { status: res.status, json, text: buf.toString("latin1"), buf };
    } catch (e) { return { status: 0, json: null, text: String(e), buf: Buffer.alloc(0) }; }
  }
  login = (email: string) => this.req("POST", "/api/auth/login", JSON.stringify({ email, password: PW }), { "Content-Type": "application/json" });
  upload(bytes: Buffer) { const fd = new FormData(); fd.append("file", new Blob([bytes], { type: "image/png" }), "p.png"); return this.req("POST", "/api/profile/photo", fd); }
  json = (method: string, p: string, body: object) => this.req(method, p, JSON.stringify(body), { "Content-Type": "application/json" });
}
/** A session on every instance for one account (cookies are signed with the shared secret; sessions live in the shared database). */
async function sessions(email: string): Promise<Client[]> {
  const out: Client[] = [];
  for (const b of bases) { const c = new Client(b); const r = await c.login(email); if (r.status !== 200) throw new Error(`login failed ${r.status}`); out.push(c); }
  return out;
}

let seq = 0;
const png = (shade: number) => F.pngFile({ w: 60 + (shade % 7), h: 40, before: [] }); // distinct bytes per shade via size
const mkAccount = async (role = "MEMBER", withMember = true) => {
  const n = ++seq;
  const user = await prisma.user.create({ data: { email: `u${n}-${crypto.randomUUID().slice(0, 6)}@example.org`, passwordHash: hash, role } });
  const member = withMember ? await prisma.teamMember.create({ data: { name: `Member ${n}`, initials: "MM", role: "Researcher", category: "MSC", userId: user.id, photoUrl: "", department: "D", bio: "B0" } }) : null;
  return { user, member, s: await sessions(user.email) };
};
const manager = await mkAccount("LAB_MANAGER", false);
const admin = await mkAccount("ADMIN", false);
const bystander = await mkAccount();
/** Debugging aid for running the CONTROL scenario against code that predates the photo endpoint (no upload route exists there). */
const NO_PHOTO = process.env.NO_PHOTO_FEATURE === "1";
let bystanderUrl = "";
if (!NO_PHOTO) {
  const bystanderUp = await bystander.s[0].upload(png(1));
  if (bystanderUp.status !== 201) throw new Error("bystander setup failed");
  bystanderUrl = bystanderUp.json.photoUrl;
}

// ---- invariants -------------------------------------------------------------------------------------------------------------
let checks = 0;
const failures: string[] = [];
const t = (name: string, ok: boolean, detail = "") => { checks++; if (!ok) failures.push(detail ? `${name} :: ${detail}` : name); };
const blobOf = (key: string) => fs.existsSync(path.join(storageDir, key));
const idOf = (url: string) => url.split("/").pop()!;
async function invariants(label: string) {
  const members = await prisma.teamMember.findMany();
  for (const m of members) {
    if (!m.photoUrl.startsWith("/api/files/")) continue;
    const f = await prisma.storedFile.findUnique({ where: { id: idOf(m.photoUrl) } });
    t(`${label}: a member's uploaded photo row exists and is live`, !!f && f.deletedAt === null, `${m.name} -> ${m.photoUrl}`);
    if (f) {
      t(`${label}: it belongs to that member (TEAM_MEMBER/entityId)`, f.entityType === "TEAM_MEMBER" && f.entityId === m.id);
      t(`${label}: its blob exists (never removed while referenced)`, blobOf(f.storageKey), m.name);
      if (blobOf(f.storageKey)) t(`${label}: its bytes match the stored SHA-256`, crypto.createHash("sha256").update(fs.readFileSync(path.join(storageDir, f.storageKey))).digest("hex") === f.sha256);
    }
  }
  const memberIds = new Set(members.map((m) => m.id));
  const refd = new Set(members.map((m) => m.photoUrl));
  for (const f of await prisma.storedFile.findMany({ where: { entityType: "TEAM_MEMBER", deletedAt: null } })) {
    t(`${label}: no live profile-photo file is orphaned from a deleted member`, memberIds.has(f.entityId!), `file ${f.id}`);
    t(`${label}: no live profile-photo file is unreferenced (no leaked live file)`, refd.has(`/api/files/${f.id}`), `file ${f.id} of ${f.entityId}`);
  }
  for (const f of await prisma.storedFile.findMany({ where: { deletedAt: null } })) t(`${label}: every live file row has its blob`, blobOf(f.storageKey), `file ${f.id}`);
  // Blobs on disk with no row at all (a leak; recoverable by the storage reconcile job, which removes unreferenced blobs after a grace period).
  const keys = new Set((await prisma.storedFile.findMany({ select: { storageKey: true } })).map((r) => r.storageKey));
  for (const name of fs.existsSync(storageDir) ? fs.readdirSync(storageDir) : []) if (!keys.has(name)) orphanBlobs.add(name);
  if (NO_PHOTO) return;
  const by = await prisma.teamMember.findUnique({ where: { id: bystander.member!.id } });
  const byFile = await prisma.storedFile.findUnique({ where: { id: idOf(bystanderUrl) } });
  t(`${label}: another member's photo is untouched`, by?.photoUrl === bystanderUrl && byFile?.deletedAt === null && blobOf(byFile!.storageKey));
}
/**
 * The probe runs in its OWN short-lived process. A libSQL connection whose COMMIT failed with SQLITE_BUSY keeps its lock even after
 * ROLLBACK and close() (see docs), so a probe that failed in THIS process would poison every later probe. Here a leak dies with the probe.
 */
const PROBE_SOURCE = `
const { createClient } = require("@libsql/client");
(async () => {
  const c = createClient({ url: process.argv[1] });
  try {
    await c.execute("CREATE TABLE IF NOT EXISTS _lockprobe (x INTEGER)");
    await c.execute("BEGIN IMMEDIATE");
    await c.execute("INSERT INTO _lockprobe VALUES (1)");
    await c.execute("COMMIT");
    process.exit(0);
  } catch { process.exit(1); }
})();`;
function probeOnce(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["-e", PROBE_SOURCE, dbUrl], { cwd: SERVER, env: { PATH: process.env.PATH }, stdio: "ignore" });
    const timer = setTimeout(() => { p.kill("SIGKILL"); resolve(false); }, 15000);
    p.on("exit", (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}
/** True once a COMMITTED write succeeds on the database file (polls up to `graceMs`); a write that commits needs every other connection's read lock gone. */
async function lockReleased(graceMs = 8000): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  for (;;) {
    if (await probeOnce()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}
const diagnosis: string[] = [];
let sawPlaceholder = false;
const orphanBlobs = new Set<string>(); // distinct blob files
const hist: Record<string, number> = {};
const tally = (k: string, status: number) => { const key = `${k}:${status === 0 ? "net" : status >= 500 ? "5xx" : status}`; hist[key] = (hist[key] ?? 0) + 1; };
const noLeak = (label: string, r: { status: number; text: string }) => { if (r.status >= 500 || r.status === 0) t(`${label}: a failed response leaks no internals`, !/Prisma|SQL|storageKey|scl-photo-conc|\/tmp\//i.test(r.text), r.text.slice(0, 100)); };

/** The instance a request goes to: always the first (same) or alternating (cross), starting at a random offset. */
const pick = (i: number, off: number) => (topology === "cross" ? (i + off) % bases.length : 0);

type Setter = { kind: string; ok: boolean; value: string };
async function fresh() {
  const acc = await mkAccount();
  if (NO_PHOTO) return { ...acc, p0: "" };
  const up = await acc.s[0].upload(png(2));
  if (up.status !== 201) throw new Error(`setup upload failed ${up.status} ${up.text.slice(0, 80)}`);
  return { ...acc, p0: up.json.photoUrl as string };
}
const photoOf = async (id: string) => (await prisma.teamMember.findUnique({ where: { id } }))?.photoUrl;
function expectFinal(label: string, p0: string, final: string | undefined, setters: Setter[]) {
  const wins = setters.filter((s) => s.ok).map((s) => s.value);
  const allowed = wins.length ? new Set(wins) : new Set([p0]);
  t(`${label}: the final photoUrl is the value of a SUCCESSFUL operation (or unchanged if none succeeded)`, final !== undefined && allowed.has(final), `final=${final} allowed=${[...allowed]}`);
  if (wins.length) t(`${label}: a successful operation is never reverted to the original photo`, final !== p0 || wins.includes(p0));
}

const EXT = "https://photos.example.org/a.png";
const EXT2 = "https://photos.example.org/b.png";
const scenarios: Record<string, () => Promise<void>> = {
  async "control: two text-only profile PUTs (a read-then-write transaction that predates the photo feature)"() {
    const a = await fresh(); const off = Math.floor(Math.random() * 2);
    const [x, y] = await Promise.all([a.s[pick(0, off)].json("PUT", "/api/profile", { bio: "first" }), a.s[pick(1, off)].json("PUT", "/api/profile", { bio: "second" })]);
    tally("control-put", x.status); tally("control-put", y.status); noLeak("x", x); noLeak("y", y);
    const m = await prisma.teamMember.findUnique({ where: { id: a.member!.id } });
    t("control: the stored text belongs to a successful save", [x.status === 200 ? "first" : null, y.status === 200 ? "second" : null, x.status !== 200 && y.status !== 200 ? "B0" : null].includes(m!.bio));
    t("control: the photo is untouched", m?.photoUrl === a.p0);
  },
  async "profile PUT (text only) vs upload"() {
    const a = await fresh(); const off = Math.floor(Math.random() * 2);
    const bio = `bio-${crypto.randomUUID().slice(0, 6)}`;
    const [put, up] = await Promise.all([a.s[pick(0, off)].json("PUT", "/api/profile", { bio }), a.s[pick(1, off)].upload(png(3))]);
    tally("put-text", put.status); tally("upload", up.status); noLeak("put", put); noLeak("upload", up);
    const m = await prisma.teamMember.findUnique({ where: { id: a.member!.id } });
    t("text save: success means the text is stored; failure means it is not", put.status === 200 ? m?.bio === bio : m?.bio === "B0");
    expectFinal("text-vs-upload", a.p0, m?.photoUrl, [{ kind: "upload", ok: up.status === 201, value: up.json?.photoUrl }]);
    if (put.status === 200 && up.status === 201) t("a text-only save never reverts a successful upload", m?.photoUrl === up.json.photoUrl);
  },
  async "profile PUT (clear photo) vs upload"() {
    const a = await fresh(); const off = Math.floor(Math.random() * 2);
    const [clr, up] = await Promise.all([a.s[pick(0, off)].json("PUT", "/api/profile", { photoUrl: "" }), a.s[pick(1, off)].upload(png(4))]);
    tally("put-clear", clr.status); tally("upload", up.status); noLeak("clear", clr); noLeak("upload", up);
    expectFinal("clear-vs-upload", a.p0, await photoOf(a.member!.id), [{ kind: "clear", ok: clr.status === 200, value: "" }, { kind: "upload", ok: up.status === 201, value: up.json?.photoUrl }]);
  },
  async "profile PUT (external URL) vs upload"() {
    const a = await fresh(); const off = Math.floor(Math.random() * 2);
    const [put, up] = await Promise.all([a.s[pick(0, off)].json("PUT", "/api/profile", { photoUrl: EXT }), a.s[pick(1, off)].upload(png(5))]);
    tally("put-ext", put.status); tally("upload", up.status); noLeak("put", put); noLeak("upload", up);
    expectFinal("ext-vs-upload", a.p0, await photoOf(a.member!.id), [{ kind: "ext", ok: put.status === 200, value: EXT }, { kind: "upload", ok: up.status === 201, value: up.json?.photoUrl }]);
  },
  async "member DELETE (admin) vs upload"() {
    const a = await fresh(); const off = Math.floor(Math.random() * 2);
    const [del, up] = await Promise.all([admin.s[pick(0, off)].req("DELETE", `/api/team/${a.member!.id}`), a.s[pick(1, off)].upload(png(6))]);
    tally("member-delete", del.status); tally("upload", up.status); noLeak("delete", del); noLeak("upload", up);
    const m = await prisma.teamMember.findUnique({ where: { id: a.member!.id } });
    t("member delete: success means the member is gone; failure means it is still there", del.status === 200 ? m === null : m !== null);
    if (del.status !== 200 && up.status === 201 && m) t("delete failed, upload succeeded: the member points at the new photo", m.photoUrl === up.json.photoUrl);
    const left = await prisma.storedFile.count({ where: { entityType: "TEAM_MEMBER", entityId: a.member!.id, deletedAt: null } });
    if (del.status === 200) t("member deleted: no live photo file of that member remains", left === 0, `${left} live`);
  },
  async "two concurrent clears (own PUT + own PUT)"() {
    const a = await fresh(); const off = Math.floor(Math.random() * 2);
    const [c1, c2] = await Promise.all([a.s[pick(0, off)].json("PUT", "/api/profile", { photoUrl: "" }), a.s[pick(1, off)].json("PUT", "/api/profile", { photoUrl: "" })]);
    tally("clear", c1.status); tally("clear", c2.status); noLeak("c1", c1); noLeak("c2", c2);
    expectFinal("clear-vs-clear", a.p0, await photoOf(a.member!.id), [{ kind: "c", ok: c1.status === 200, value: "" }, { kind: "c", ok: c2.status === 200, value: "" }]);
    const f = await prisma.storedFile.findUnique({ where: { id: idOf(a.p0) } });
    if (c1.status === 200 || c2.status === 200) t("a cleared photo's file is retired exactly once and answers 404", f?.deletedAt !== null && (await new Client(bases[0]).req("GET", a.p0)).status === 404);
  },
  async "clear by owner PUT vs manager PUT vs file DELETE"() {
    const a = await fresh(); const off = Math.floor(Math.random() * 2);
    const [c1, c2, c3] = await Promise.all([
      a.s[pick(0, off)].json("PUT", "/api/profile", { photoUrl: "" }),
      manager.s[pick(1, off)].json("PUT", `/api/team/${a.member!.id}`, { photoUrl: "" }),
      a.s[pick(2, off)].req("DELETE", `/api/files/${idOf(a.p0)}`),
    ]);
    tally("clear-own", c1.status); tally("clear-mgr", c2.status); tally("file-delete", c3.status);
    for (const [n, r] of [["own", c1], ["mgr", c2], ["file", c3]] as const) noLeak(n, r);
    expectFinal("three-way-clear", a.p0, await photoOf(a.member!.id), [{ kind: "a", ok: c1.status === 200, value: "" }, { kind: "b", ok: c2.status === 200, value: "" }, { kind: "c", ok: c3.status === 200, value: "" }]);
    const f = await prisma.storedFile.findUnique({ where: { id: idOf(a.p0) } });
    if ([c1, c2, c3].some((r) => r.status === 200)) t("the file is retired once any clear/delete succeeded", f?.deletedAt !== null);
  },
  async "replacement: upload vs upload"() {
    const a = await fresh(); const off = Math.floor(Math.random() * 2);
    const [u1, u2] = await Promise.all([a.s[pick(0, off)].upload(png(3)), a.s[pick(1, off)].upload(png(4))]);
    tally("upload", u1.status); tally("upload", u2.status); noLeak("u1", u1); noLeak("u2", u2);
    expectFinal("upload-vs-upload", a.p0, await photoOf(a.member!.id), [{ kind: "u", ok: u1.status === 201, value: u1.json?.photoUrl }, { kind: "u", ok: u2.status === 201, value: u2.json?.photoUrl }]);
    const live = await prisma.storedFile.count({ where: { entityType: "TEAM_MEMBER", entityId: a.member!.id, deletedAt: null } });
    t("after two uploads exactly one live photo remains (or the original if both failed)", live === 1, `${live} live`);
  },
  async "replacement: external URL vs external URL"() {
    const a = await fresh(); const off = Math.floor(Math.random() * 2);
    const [p1, p2] = await Promise.all([a.s[pick(0, off)].json("PUT", "/api/profile", { photoUrl: EXT }), manager.s[pick(1, off)].json("PUT", `/api/team/${a.member!.id}`, { photoUrl: EXT2 })]);
    tally("ext", p1.status); tally("ext-mgr", p2.status); noLeak("p1", p1); noLeak("p2", p2);
    expectFinal("ext-vs-ext", a.p0, await photoOf(a.member!.id), [{ kind: "a", ok: p1.status === 200, value: EXT }, { kind: "b", ok: p2.status === 200, value: EXT2 }]);
    if (p1.status === 200 || p2.status === 200) t("the replaced uploaded file is retired", (await prisma.storedFile.findUnique({ where: { id: idOf(a.p0) } }))?.deletedAt !== null);
  },
};

let outcome = 0;
try {
  const only = process.env.ONLY_SCENARIO; // debugging aid: substring of a scenario name
  for (const [name, run] of Object.entries(scenarios)) {
    if (only && !name.includes(only)) continue;
    for (let r = 0; r < ROUNDS; r++) {
      if (stderrLines.join("").includes("local-embedded-placeholder")) sawPlaceholder = true; // scan before clearing
      stderrLines.length = 0; // the "last server error lines" diagnosis below should describe THIS round only
      let roundError: string | null = null;
      try { await run(); } catch (e) { roundError = String((e as Error).message).split("\n").pop()?.slice(0, 120) || "error"; }
      const released = await lockReleased();
      // A round that threw while NO lock was left behind is not explained by the known lock problem: it is reported on its own.
      if (roundError) failures.push(released ? `${name}: UNEXPLAINED round error (no lock left behind) ${roundError}` : `${name}: round error ${roundError}`);
      t(`${name}: no database write lock is left behind once the requests have settled`, released);
      if (!released) {
        for (let i = 0; i < children.length; i++) {
          children[i].kill("SIGTERM");
          await new Promise((r) => setTimeout(r, 1500));
          if (await lockReleased(2500)) { diagnosis.push(`the lock was released only after instance ${i} was stopped (it held a transaction open)`); break; }
        }
        hist["LOCK-LEFT-BEHIND"] = (hist["LOCK-LEFT-BEHIND"] ?? 0) + 1;
        const lastErr = stderrLines.join("").split("\n").filter((l) => /SQLITE|P10|Timed out|Error/.test(l)).slice(-3).map((l) => l.slice(0, 160));
        if (lastErr.length) diagnosis.push(`last server error lines: ${lastErr.join(" || ")}`);
        for (let i = 0; i < children.length; i++) { if (children[i].exitCode === null && children[i].signalCode === null) { children[i].kill("SIGTERM"); await new Promise((r) => setTimeout(r, 800)); } startInstance(i); }
        await waitUp(); failures.push(`${name}: database stayed locked until the instances were restarted`); }
      await invariants(name);
    }
  }
  t("no uncaught server crash (all instances still answer)", (await Promise.all(bases.map((b) => fetch(b + "/api/health").then((r) => r.ok).catch(() => false)))).every(Boolean));
} finally {
  stopAll();
  await prisma.$disconnect().catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
}
const hasSecretLike = sawPlaceholder || stderrLines.join("").includes("local-embedded-placeholder");
t("the placeholder token never reached a log", !hasSecretLike);
if (process.env.KEEP_WORKDIR !== "1") fs.rmSync(work, { recursive: true, force: true });
else console.log("kept " + work);
console.log(`[engine=${engine} topology=${topology} rounds=${ROUNDS}] ${checks - failures.length} concurrency checks passed, ${failures.length} failed.`);
console.log(`outcome histogram: ${Object.entries(hist).sort().map(([k, v]) => `${k}=${v}`).join(" ")}`);
for (const d of diagnosis) console.log("diagnosis: " + d);
const isLock = (f: string) => /write lock is left behind|stayed locked/.test(f);
const isUnexplained = (f: string) => /UNEXPLAINED round error/.test(f);
const isSetup = (f: string) => !isUnexplained(f) && /round error|setup upload failed/.test(f);
const dataFailures = failures.filter((f) => !isLock(f) && !isSetup(f)); // includes UNEXPLAINED round errors
console.log(`blob files without any database row observed at round ends (distinct; recoverable leaks that the storage reconcile job removes, not invariant failures): ${orphanBlobs.size}`);
console.log(`failure classes: data-invariant=${dataFailures.length} lock-left-behind=${failures.filter(isLock).length} round/setup errors (usually the consequence of a left-behind lock)=${failures.filter(isSetup).length}`);
const counted = new Map<string, number>();
for (const f of failures) counted.set(f, (counted.get(f) ?? 0) + 1);
for (const [f, n] of [...counted].slice(0, 40)) console.log(` - ${n}x ${f}`);
outcome = failures.length ? 1 : 0;
process.exit(outcome);

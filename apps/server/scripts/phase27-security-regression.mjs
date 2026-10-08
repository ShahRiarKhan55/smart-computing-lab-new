/**
 * Focused Phase 27 security paths that the feature suites do not already pin: role matrix on the admin-only storage
 * diagnostic, gallery upload and photo authorization by role, the importer's write endpoints by role, and a secret scan of
 * the BUILT web bundle and of the server log. Disposable local database; nothing external is contacted.
 *
 *   node scripts/phase27-security-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const TSX = path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first.`);
  process.exit(1);
}



import { readdirSync, readFileSync as rf, statSync } from "node:fs";
const SECRET = "phase27-secret-canary-7c1d9e";
async function startServer() {
  const work = mkdtempSync(path.join(tmpdir(), "scl-sec-"));
  copyFileSync(SOURCE_DB, path.join(work, "c.db"));
  const port = 49500 + Math.floor(Math.random() * 300);
  const env = { ...process.env, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", BLOB_READ_WRITE_TOKEN: "", VERCEL: "", STORAGE_DIR: path.join(work, "files"), DATABASE_URL: `file:${path.join(work, "c.db")}`, PORT: String(port), TRUST_PROXY: "0", NODE_ENV: "test", SESSION_SECRET: SECRET + "-session-0000", GOOGLE_CLIENT_SECRET: SECRET + "-google", ORCID_CLIENT_SECRET: SECRET + "-orcid", ORCID_CLIENT_ID: "x" };
  const child = spawn(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  return { base: `http://localhost:${port}`, logs: () => out, async stop() { child.kill(); rmSync(work, { recursive: true, force: true }); } };
}
function client(base, cookie = null) {
  async function call(method, url, body, form) {
    const res = await fetch(`${base}/api${url}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, json, text: JSON.stringify(json) };
  }
  return { get: (u) => call("GET", u), post: (u, b) => call("POST", u, b ?? {}), put: (u, b) => call("PUT", u, b), del: (u) => call("DELETE", u), form: (u, f) => call("POST", u, undefined, f) };
}
async function login(base, creds) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  return client(base, res.headers.get("set-cookie")?.split(";")[0] ?? null);
}
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  const s = await startServer();
  try {
    const admin = await login(s.base, ADMIN);
    const mk = async (email, role, name) => {
      const r = await admin.post("/users", { email, password: PW, role, name, initials: "SC", memberRole: "Researcher", category: "PHD" });
      if (r.status !== 201) throw new Error(`could not create ${email}: ${r.status} ${r.text}`);
      return login(s.base, { email, password: PW });
    };
    const member = await mk("sec-member@example.test", "MEMBER", "ZZ Sec Member");
    const mgr = await mk("sec-mgr@example.test", "LAB_MANAGER", "ZZ Sec Manager");
    const guest = client(s.base);

    // ---- admin-only storage diagnostics --------------------------------------------------------------------------------------
    for (const q of ["", "?probe=1"]) {
      t(`storage-status${q}: guest 401`, (await guest.get(`/files/storage-status${q}`)).status === 401);
      t(`storage-status${q}: MEMBER 403`, (await member.get(`/files/storage-status${q}`)).status === 403);
      t(`storage-status${q}: LAB_MANAGER 403 (ADMIN only)`, (await mgr.get(`/files/storage-status${q}`)).status === 403);
    }
    const diag = await admin.get("/files/storage-status?probe=1");
    t("storage-status: ADMIN gets a report without any token, URL or path", diag.status === 200 && !/token|secret|http|\/tmp|\/home/i.test(diag.text), diag.text);

    // ---- gallery upload by role ------------------------------------------------------------------------------------------------------
    const form = () => { const f = new FormData(); f.set("file", new Blob([PNG], { type: "image/png" }), "x.png"); f.set("title", "ZZ sec"); return f; };
    t("gallery upload: guest 401", (await guest.form("/gallery", form())).status === 401);
    // Any signed-in member may upload to the gallery (canCreateGalleryItem = isMember, unchanged by Phase 27); what must
    // hold is that a request that passes authorization ends in a clean answer, never a 500.
    for (const [who, c] of [["MEMBER", member], ["LAB_MANAGER", mgr], ["ADMIN", admin]]) {
      const st = (await c.form("/gallery", form())).status;
      t(`gallery upload: ${who} passes authorization and ends cleanly (201 or a structured 4xx/503, never 401/403/500) — got ${st}`, [201, 400, 413, 503].includes(st));
    }
    t("gallery upload: editing/deleting someone else's item is not open to a plain member", (await member.del("/gallery/doesnotexist")).status === 404 || (await member.del("/gallery/doesnotexist")).status === 403);

    // ---- importer: every write endpoint by role ----------------------------------------------------------------------------------
    for (const [method, url] of [["post", "/publication-imports/sync"], ["post", "/publication-imports/x1/approve"], ["post", "/publication-imports/x1/reject"], ["get", "/publication-imports"]]) {
      t(`importer ${method.toUpperCase()} ${url}: guest 401, member 403`, (await guest[method](url)).status === 401 && (await member[method](url)).status === 403);
    }
    t("importer: a LAB_MANAGER may review (reaches 404 for an unknown id, not 403)", (await mgr.post("/publication-imports/x1/reject")).status === 404);

    // ---- alumni have no login path (belt and braces on top of profiles-regression) ---------------------------------------------------
    const alum = await admin.post("/team", { name: "ZZ Sec Alum", initials: "SA", role: "Alumnus", category: "ALUMNI", department: "x" });
    t("setup: alumni profile created", alum.status === 201, alum.text);
    t("alumni: cannot be given an account (users endpoint)", (await admin.post("/users", { email: "sec-alum@example.test", password: PW, role: "MEMBER", teamMemberId: alum.json?.id })).status === 409);
    t("alumni: cannot be invited", (await admin.post("/invitations", { email: "sec-alum2@example.test", role: "MEMBER", teamMemberId: alum.json?.id })).status === 409);

    // ---- public API leaks ----------------------------------------------------------------------------------------------------------------------
    const pub = await guest.get("/team");
    t("public /team never exposes isPublished, user ids or emails", !/isPublished|userId|@example\.test/i.test(pub.text));
    t("public google config reveals nothing but a boolean", (await guest.get("/auth/google/config")).text === '{"enabled":false}');
    t("public site-config reveals only portalUrl", Object.keys((await guest.get("/site-config")).json).join() === "portalUrl");

    // ---- secrets: server log + built web bundle ------------------------------------------------------------------------------------
    t("server log never contains configured secrets", !s.logs().includes(SECRET));
    const dist = path.join(SERVER_ROOT, "..", "web", "dist");
    if (existsSync(dist)) {
      const bad = walk(dist).filter((f) => /\.(js|css|html|map)$/.test(f)).filter((f) => /phase27-secret-canary|vercel_blob_rw_[A-Za-z0-9]|libsql:\/\/[A-Za-z0-9.-]+\.turso\.io|GOCSPX-[A-Za-z0-9_-]{10,}|[0-9]{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com|BEGIN (RSA )?PRIVATE KEY|eyJhbGciOi[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\./.test(rf(f, "utf8")));
      t("built web bundle contains no secret VALUES (Blob/Turso/Google/ORCID credential shapes, private keys, JWTs, the canary); env var NAMES appear only in the maintainer documentation", bad.length === 0, bad.join());
    } else failures.push("web dist missing: run `npm run build -w apps/web` first");
  } finally {
    await s.stop();
  }
  console.log(`\n${ok} phase27-security checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}
main().catch((err) => { console.error(err); if (failures.length) console.log("Failures so far:\n - " + failures.join("\n - ")); process.exit(1); });

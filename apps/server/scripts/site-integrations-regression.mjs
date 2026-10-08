/**
 * Regression for the Phase 27 portal link (P27.1) and provider-neutral homepage updates (P27.2).
 * Runs on a disposable copy of the local dev database; nothing external is contacted.
 *
 *   node scripts/site-integrations-regression.mjs
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


async function startServer(extraEnv = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "scl-site-"));
  copyFileSync(SOURCE_DB, path.join(work, "c.db"));
  const port = 48600 + Math.floor(Math.random() * 300);
  const env = {
    ...process.env,
    TURSO_DATABASE_URL: "",
    TURSO_AUTH_TOKEN: "",
    BLOB_READ_WRITE_TOKEN: "",
    VERCEL: "",
    PORTAL_URL: "",
    STORAGE_DIR: path.join(work, "files"),
    DATABASE_URL: `file:${path.join(work, "c.db")}`,
    PORT: String(port),
    TRUST_PROXY: "0",
    NODE_ENV: "test",
    SESSION_SECRET: "site-integrations-secret-00000000000000",
    ...extraEnv,
  };
  const child = spawn(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  return { base: `http://localhost:${port}`, prisma, async stop() { child.kill(); await prisma.$disconnect(); rmSync(work, { recursive: true, force: true }); } };
}

function client(base, cookie = null) {
  async function call(method, url, body) {
    const res = await fetch(`${base}/api${url}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers };
  }
  return { get: (u, h) => call("GET", u, undefined, h), post: (u, b) => call("POST", u, b ?? {}), put: (u, b) => call("PUT", u, b), del: (u) => call("DELETE", u) };
}
async function login(base, creds) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  return client(base, res.headers.get("set-cookie")?.split(";")[0] ?? null);
}

async function main() {
  // ---- portal link: configured / unset / unsafe values -------------------------------------------------
  for (const [label, value, want] of [
    ["unset", "", null],
    ["a valid https URL", "https://sites.google.com/view/example-lab", "https://sites.google.com/view/example-lab"],
    ["plain http", "http://sites.google.com/view/example-lab", null],
    ["a javascript: URL", "javascript:alert(1)", null],
    ["credentials in the URL", "https://user:pw@sites.google.com/view/x", null],
    ["garbage", "not a url", null],
  ]) {
    const s = await startServer({ PORTAL_URL: value });
    try {
      const r = await client(s.base).get("/site-config");
      t(`portal: ${label} -> ${want === null ? "no link" : "that link"}`, r.status === 200 && r.json.portalUrl === want, JSON.stringify(r.json));
      t(`portal: ${label} -> response is exactly {portalUrl} (no other settings or secrets leak)`, Object.keys(r.json).join() === "portalUrl");
    } finally {
      await s.stop();
    }
  }

  // ---- updates ------------------------------------------------------------------------------------------
  const s = await startServer();
  try {
    const admin = await login(s.base, ADMIN);
    const guest = client(s.base);
    const mk = async (title, sortDate, extra = {}) => (await admin.post("/news", { date: "Jan 2040", sortDate, type: "Paper", title, description: "d", ...extra })).json;
    const a = await mk("ZZ U Public Old", "2040-01-01");
    const b = await mk("ZZ U Public New", "2040-03-01");
    const c = await mk("ZZ U Hidden Newest", "2040-04-01", { visibility: "LAB_ONLY" });
    await admin.put(`/news/${a.id}`, { translations: { ja: { title: "ZZ U 日本語 古い" } } });

    const g = await guest.get("/updates?limit=50");
    t("updates: public endpoint answers guests", g.status === 200 && Array.isArray(g.json.items));
    const titles = g.json.items.map((i) => i.title);
    t("updates: lab-only items are NOT sent to guests", !titles.includes("ZZ U Hidden Newest") && !JSON.stringify(g.json).includes(c.id));
    t("updates: newest first", titles.indexOf("ZZ U Public New") < titles.indexOf("ZZ U Public Old") && titles.indexOf("ZZ U Public New") !== -1);
    t("updates: every item says where it came from (manual)", g.json.items.every((i) => i.source?.id === "manual" && i.source?.kind === "manual"));
    t("updates: a guest is never sent the visibility field", g.json.items.every((i) => !("visibility" in i)));
    t("updates: the Facebook source is reported honestly as not configured and contributes nothing", g.json.sources.some((x) => x.id === "facebook" && x.status === "not_configured") && g.json.items.every((i) => i.source.id !== "facebook"));
    t("updates: no fabricated external item or social URL anywhere in the response", !/facebook\.com|fb\.com/i.test(JSON.stringify(g.json)));
    const m = await admin.get("/updates?limit=50");
    t("updates: a manager sees the lab-only item first, with its visibility", m.json.items[0]?.title === "ZZ U Hidden Newest" && m.json.items[0].visibility === "LAB_ONLY");
    t("updates: limit is honoured", (await guest.get("/updates?limit=1")).json.items.length === 1);
    t("updates: default limit is small", (await guest.get("/updates")).json.items.length <= 6);
    t("updates: a bad limit is a 400", (await guest.get("/updates?limit=abc")).status === 400 && (await guest.get("/updates?limit=0")).status === 400 && (await guest.get("/updates?limit=9999")).status === 400);
    const ja = await fetch(`${s.base}/api/updates?limit=50`, { headers: { "x-locale": "ja" } }).then((r) => r.json());
    t("updates: Japanese overrides are applied like the news list", ja.items.some((i) => i.title === "ZZ U 日本語 古い"));
    const news = await guest.get("/news");
    t("updates: the existing /news endpoint is unchanged (plain array, no source field)", Array.isArray(news.json) && news.json.every((i) => !("source" in i)));
    await s.prisma.newsItem.deleteMany({});
    const empty = await guest.get("/updates");
    t("updates: with no news the answer is an honest empty list (not an error, nothing invented)", empty.status === 200 && empty.json.items.length === 0);
  } finally {
    await s.stop();
  }
  console.log(`\n${ok} site-integration checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}
main().catch((err) => {
  console.error(err);
  if (failures.length) console.log("Failures so far:\n - " + failures.join("\n - "));
  process.exit(1);
});

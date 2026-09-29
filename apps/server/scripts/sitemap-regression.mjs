/**
 * Regression check for the Phase 26 robots.txt / sitemap.xml routes (routes/sitemap.routes.ts):
 * public pages are included, LAB_ONLY content is never leaked into the sitemap, and a missing
 * PUBLIC_BASE_URL is handled explicitly rather than guessed.
 *
 * Self-contained: copies apps/server/prisma/dev.db to a disposable temp file, creates its own
 * "ZZ Sitemap Test" fixtures directly via Prisma (one PUBLIC and one LAB_ONLY ResearchProject —
 * seed.ts does not seed any, since it predates Phase 8), spawns the real server twice (with and
 * without PUBLIC_BASE_URL), runs checks, tears everything down. Requires
 * apps/server/prisma/dev.db to exist and be seeded (`npm run seed -w apps/server`).
 *
 *   node scripts/sitemap-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => {
  if (cond) ok++;
  else failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
};

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first (see script header).`);
  process.exit(1);
}

const workDir = mkdtempSync(path.join(tmpdir(), "scl-sitemap-regression-"));
const dbCopy = path.join(workDir, "copy.db");
copyFileSync(SOURCE_DB, dbCopy);
const DATABASE_URL = `file:${dbCopy}`;

function startServer(env) {
  const child = spawn(process.execPath, [path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs"), path.join(SERVER_ROOT, "src", "index.ts")], {
    cwd: SERVER_ROOT,
    env,
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`Server did not start in time. Output so far:\n${out}`)), 15000);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (/listening on/.test(out)) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (d) => { out += d.toString(); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early (code ${code}). Output:\n${out}`));
    });
  });
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

  // A minimal, real, non-manager account to satisfy ResearchProject's required relations.
  const owner = await prisma.user.findFirst({ where: { email: "admin@smartcomputinglab.org" } });
  if (!owner) throw new Error("Expected the seeded admin account to exist — run `npm run seed -w apps/server` first.");

  const publicProject = await prisma.researchProject.create({
    data: { title: "ZZ Sitemap Test Public Project", slug: `zz-sitemap-public-${Date.now()}`, visibility: "PUBLIC", summary: "" },
  });
  const hiddenProject = await prisma.researchProject.create({
    data: { title: "ZZ Sitemap Test Hidden Project", slug: `zz-sitemap-hidden-${Date.now()}`, visibility: "LAB_ONLY", summary: "" },
  });

  try {
    // ---- PUBLIC_BASE_URL unset: /sitemap.xml is explicitly unavailable, /robots.txt still works --
    {
      const port = 45700 + Math.floor(Math.random() * 200);
      const server = await startServer({ ...process.env, NODE_ENV: "test", TRUST_PROXY: "0", PORT: String(port), DATABASE_URL });
      try {
        const sitemapRes = await fetch(`http://localhost:${port}/sitemap.xml`);
        t("sitemap.xml is 404 when PUBLIC_BASE_URL is unset (never a fabricated domain)", sitemapRes.status === 404);
        const robotsRes = await fetch(`http://localhost:${port}/robots.txt`);
        const robotsBody = await robotsRes.text();
        t("robots.txt still works when PUBLIC_BASE_URL is unset", robotsRes.status === 200);
        t("robots.txt omits the Sitemap: line when PUBLIC_BASE_URL is unset", !robotsBody.includes("Sitemap:"));
        t("robots.txt disallows /api/", robotsBody.includes("Disallow: /api/"));
        t("robots.txt disallows /admin", robotsBody.includes("Disallow: /admin"));
      } finally {
        server.kill();
      }
    }

    // ---- PUBLIC_BASE_URL set: sitemap includes public content, excludes LAB_ONLY content ---------
    {
      const port = 45900 + Math.floor(Math.random() * 200);
      const base = "https://labs.example.test";
      const server = await startServer({ ...process.env, NODE_ENV: "test", TRUST_PROXY: "0", PORT: String(port), DATABASE_URL, PUBLIC_BASE_URL: base });
      try {
        const robotsRes = await fetch(`http://localhost:${port}/robots.txt`);
        const robotsBody = await robotsRes.text();
        t("robots.txt includes the Sitemap: line once PUBLIC_BASE_URL is set", robotsBody.includes(`Sitemap: ${base}/sitemap.xml`));

        const res = await fetch(`http://localhost:${port}/sitemap.xml`);
        t("sitemap.xml is 200 once PUBLIC_BASE_URL is set", res.status === 200);
        t("sitemap.xml has the right content type", (res.headers.get("content-type") || "").includes("application/xml"));
        const xml = await res.text();

        t("home page is present", xml.includes(`<loc>${base}/</loc>`));
        t("every static public page is present", ["/research", "/projects", "/team", "/publications", "/news", "/events", "/knowledge", "/resources", "/gallery", "/contact"].every((p) => xml.includes(`<loc>${base}${p}</loc>`)));
        t("the PUBLIC research project IS in the sitemap", xml.includes(`/projects/${publicProject.id}`));
        t("the LAB_ONLY research project is NEVER in the sitemap (visibility leak)", !xml.includes(`/projects/${hiddenProject.id}`));
        t("the LAB_ONLY project's title never appears either (no metadata leak)", !xml.includes("ZZ Sitemap Test Hidden Project"));
        t("no auth-gated page (e.g. /login) is ever listed", !xml.includes(`<loc>${base}/login</loc>`));
        t("no admin page is ever listed", !xml.includes(`${base}/admin`));
        t("no forum page is ever listed", !xml.includes(`${base}/community`));
        t("the sitemap is well-formed enough to round-trip through a strict XML check (no unescaped &)", !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml));
      } finally {
        server.kill();
      }
    }

    console.log(`\n${ok} sitemap regression checks passed, ${failures.length} failed.`);
    if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  } finally {
    await prisma.researchProject.delete({ where: { id: publicProject.id } }).catch(() => {});
    await prisma.researchProject.delete({ where: { id: hiddenProject.id } }).catch(() => {});
    await prisma.$disconnect();
    rmSync(workDir, { recursive: true, force: true });
  }

  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
});

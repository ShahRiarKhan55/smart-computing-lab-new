import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { STATIC_PUBLIC_PATHS, escapeXml, normalizeBaseUrl } from "../lib/sitemap.js";

/**
 * robots.txt + sitemap.xml (Phase 26 §14 — deferred by Phase 24, picked up here).
 *
 * DEPLOYMENT TOPOLOGY: these two routes are mounted at the document ROOT (`app.use(sitemapRoutes)`
 * in app.ts, not under `/api`), because search engines fetch `/robots.txt` and `/sitemap.xml` from
 * the origin root by convention — a crawler never discovers `/api/sitemap.xml`. This app's one
 * documented, supported deployment topology (see lib/trustProxy.ts) is a single reverse proxy in
 * front of both the static SPA build and this API; that proxy must route `/robots.txt`,
 * `/sitemap.xml` and `/api/*` to this server, and everything else to the static SPA build. See
 * docs/architecture/phase26-deployment-readiness-infrastructure-hardening.md for the full
 * deployment checklist.
 *
 * VISIBILITY: the sitemap is generated as a true, unauthenticated guest would see the site — it
 * NEVER includes a PUBLIC/LAB_ONLY item's presence at all when it is LAB_ONLY. This intentionally
 * reuses the exact same `visibility: "PUBLIC"` filter every other guest-facing route uses (see
 * lib/visibility.ts `visibleTo`), rather than a second, parallel notion of "public" that could
 * drift from it. `TeamMember` has no visibility field at all (the team roster is unconditionally
 * public, same as `GET /api/team` — see routes/team.routes.ts), so every row is included.
 *
 * BASE URL: sitemap entries must be absolute URLs per the sitemap protocol. This app has no
 * hardcoded production domain anywhere (Phase 24 deliberately deferred this — see
 * docs/architecture/phase24-…), so the base URL comes only from `PUBLIC_BASE_URL`. If it is not
 * set, `/sitemap.xml` answers 404 with an explanatory body rather than guessing/fabricating a
 * domain; `/robots.txt` still works either way, simply omitting its `Sitemap:` line.
 *
 * LOCALE: this app has no locale-prefixed routing (see apps/web/src/i18n/LocaleContext.tsx —
 * locale is a client-side preference in `localStorage` plus an `X-Locale` request header, not part
 * of the URL). There is therefore exactly one URL per page regardless of language, and no EN/JA
 * URL variants or `hreflang` alternates to list — documented here rather than invented.
 */
const router = Router();

interface SitemapEntry {
  path: string;
  updatedAt?: Date;
}

async function collectPublicEntries(): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = STATIC_PUBLIC_PATHS.map((path) => ({ path }));

  const [areas, projects, groups, team, publications, events, knowledgeDocs, resources] = await Promise.all([
    prisma.researchArea.findMany({ where: { visibility: "PUBLIC" }, select: { id: true, updatedAt: true } }),
    prisma.researchProject.findMany({ where: { visibility: "PUBLIC" }, select: { id: true, updatedAt: true } }),
    prisma.researchGroup.findMany({ where: { visibility: "PUBLIC" }, select: { id: true, updatedAt: true } }),
    prisma.teamMember.findMany({ select: { id: true, updatedAt: true } }),
    prisma.publication.findMany({ where: { visibility: "PUBLIC" }, select: { id: true, updatedAt: true } }),
    prisma.event.findMany({ where: { visibility: "PUBLIC" }, select: { id: true, updatedAt: true } }),
    prisma.knowledgeDoc.findMany({ where: { visibility: "PUBLIC" }, select: { id: true, updatedAt: true } }),
    prisma.labResource.findMany({ where: { visibility: "PUBLIC" }, select: { id: true, updatedAt: true } }),
  ]);

  for (const a of areas) entries.push({ path: `/research/${a.id}`, updatedAt: a.updatedAt });
  for (const p of projects) entries.push({ path: `/projects/${p.id}`, updatedAt: p.updatedAt });
  for (const g of groups) entries.push({ path: `/groups/${g.id}`, updatedAt: g.updatedAt });
  for (const m of team) entries.push({ path: `/team/${m.id}`, updatedAt: m.updatedAt });
  for (const p of publications) entries.push({ path: `/publications/${p.id}`, updatedAt: p.updatedAt });
  for (const e of events) entries.push({ path: `/events/${e.id}`, updatedAt: e.updatedAt });
  for (const k of knowledgeDocs) entries.push({ path: `/knowledge/${k.id}`, updatedAt: k.updatedAt });
  for (const r of resources) entries.push({ path: `/resources/${r.id}`, updatedAt: r.updatedAt });

  return entries;
}

router.get("/robots.txt", (_req, res) => {
  const base = normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
  const lines = [
    "User-agent: *",
    "Disallow: /api/",
    "Disallow: /admin",
    "Disallow: /login",
    "Disallow: /schedule",
    "Disallow: /workspace",
    "Disallow: /profile",
    "Disallow: /messages",
    "Disallow: /notifications",
    "Disallow: /community/forum",
    "Disallow: /search",
  ];
  if (base) lines.push("", `Sitemap: ${base}/sitemap.xml`);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(lines.join("\n") + "\n");
});

router.get("/sitemap.xml", async (_req, res) => {
  const base = normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
  if (!base) {
    res.status(404).type("text/plain").send("Sitemap not configured: set PUBLIC_BASE_URL to enable /sitemap.xml.");
    return;
  }
  const entries = await collectPublicEntries();
  const urls = entries
    .map((e) => {
      const loc = `${base}${e.path}`;
      const lastmod = e.updatedAt ? `\n    <lastmod>${e.updatedAt.toISOString().slice(0, 10)}</lastmod>` : "";
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

export default router;

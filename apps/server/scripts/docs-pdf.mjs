/**
 * Generates one PDF per guide, per language, from docs/user-guide/*.md — via the pre-installed
 * Chromium/Edge binary's own built-in `--print-to-pdf` flag, the same browser-launch pattern
 * scripts/browser-regression.cjs already uses (spawned directly as a child process, driven over
 * CDP/CLI flags — no Playwright/Puppeteer dependency, nothing new to install). This is
 * deterministic (same input HTML -> same PDF bytes, modulo Chromium's own version) and works
 * identically on Windows (Edge) and Linux CI (Chromium): BROWSER_PATH selects the executable,
 * defaulting to the same Windows Edge path browser-regression.cjs defaults to.
 *
 * Re-renders each guide's Markdown directly (not by importing the generated .ts modules
 * apps/web consumes) — both pipelines derive from the identical docs/user-guide/*.md source, so
 * there is still exactly one authored copy of each guide; this script just doesn't need a second
 * toolchain (ts-node/tsx) to read the first one's output.
 *
 *   node scripts/docs-pdf.mjs
 *   npm run docs:pdf -w apps/server   # runs docs-render.mjs first, then this
 *
 * Output: apps/server/dist-docs/pdf/<slug>.<locale>.pdf (gitignored; regenerate on demand).
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SOURCE_DIR = path.join(REPO_ROOT, "docs", "user-guide");
const OUT_DIR = path.join(REPO_ROOT, "apps", "server", "dist-docs", "pdf");
const EDGE = process.env.BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

marked.setOptions({ gfm: true, breaks: true });

function listSlugs(locale) {
  return readdirSync(path.join(SOURCE_DIR, locale))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

function titleOf(markdown) {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match ? match[1].trim() : "Smart Computing Lab";
}

/** A minimal, self-contained print stylesheet — no external fonts/scripts (this HTML file is
 * loaded directly from disk by Chromium, never served by the app, so it is not subject to and
 * does not need the app's own CSP). Never includes any secret, token or credential — the guides
 * themselves are written not to (see docs/user-guide/site-maintainer-guide.md's placeholder
 * convention for env vars), and this wrapper adds no content of its own beyond the rendered body. */
function wrapHtml(title, locale, bodyHtml) {
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { margin: 20mm 18mm; }
  body { font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", Helvetica, Arial, sans-serif; line-height: 1.55; color: #1a1a1a; font-size: 11pt; }
  h1 { font-size: 20pt; margin-bottom: 4pt; border-bottom: 2pt solid #1a1a1a; padding-bottom: 6pt; }
  h2 { font-size: 14pt; margin-top: 20pt; border-bottom: 0.5pt solid #ccc; padding-bottom: 3pt; }
  h3 { font-size: 12pt; margin-top: 14pt; }
  table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 10pt; }
  th, td { border: 0.5pt solid #999; padding: 4pt 7pt; text-align: left; }
  th { background: #f0f0f0; }
  code { background: #f0f0f0; padding: 1pt 3pt; font-size: 9.5pt; }
  pre { background: #f0f0f0; padding: 8pt; overflow-wrap: break-word; white-space: pre-wrap; }
  blockquote { border-left: 3pt solid #999; margin: 10pt 0; padding: 2pt 12pt; color: #444; }
  a { color: #1a4fa0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function runChromiumPrintToPdf(htmlFilePath, pdfOutPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--print-to-pdf=${pdfOutPath}`,
      "--no-pdf-header-footer",
      "--virtual-time-budget=10000",
      `file://${htmlFilePath}`,
    ];
    const child = spawn(EDGE, args);
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Chromium exited with code ${code}. stderr:\n${stderr}`));
    });
  });
}

/** Reads the first 5 bytes to confirm the PDF magic number ("%PDF-") without loading the whole
 * (potentially large) file into memory — a cheap, real content check, not just "the file exists". */
function looksLikeRealPdf(filePath) {
  const size = statSync(filePath).size;
  if (size < 1000) return false; // a real rendered guide is never this small
  const fd = openSync(filePath, "r");
  const buf = Buffer.alloc(5);
  readSync(fd, buf, 0, 5, 0);
  closeSync(fd);
  return buf.toString("ascii") === "%PDF-";
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const slugs = listSlugs("en");
  const results = [];

  for (const slug of slugs) {
    for (const locale of ["en", "ja"]) {
      const markdown = readFileSync(path.join(SOURCE_DIR, locale, `${slug}.md`), "utf8");
      const bodyHtml = marked.parse(markdown);
      const title = titleOf(markdown);
      const fullHtml = wrapHtml(title, locale, bodyHtml);

      const tmpHtmlPath = path.join(tmpdir(), `scl-docs-${slug}-${locale}-${Date.now()}.html`);
      writeFileSync(tmpHtmlPath, fullHtml, "utf8");
      const pdfPath = path.join(OUT_DIR, `${slug}.${locale}.pdf`);

      await runChromiumPrintToPdf(tmpHtmlPath, pdfPath);
      const ok = looksLikeRealPdf(pdfPath);
      const size = statSync(pdfPath).size;
      results.push({ slug, locale, ok, size, pdfPath });
      console.log(`${ok ? "OK  " : "FAIL"} ${slug}.${locale}.pdf (${(size / 1024).toFixed(1)} KB)`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PDFs generated and verified.`);
  if (failed.length) {
    console.log("Failed: " + failed.map((f) => `${f.slug}.${f.locale}`).join(", "));
    process.exit(1);
  }
  console.log(`Output directory: ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

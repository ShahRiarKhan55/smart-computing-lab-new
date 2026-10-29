/**
 * Imports the lab's publication list (the achievements-form .xlsx) into a database the operator names explicitly.
 *
 *   # 1. Dry run (the default): reads the file and the database, WRITES NOTHING, prints and saves the report.
 *   IMPORT_TARGET_URL=file:/abs/path/copy.db npx tsx scripts/import-publications.ts \
 *       --file publicationslist.xlsx --expect-target file:/abs/path/copy.db --report-dir ./import-report
 *
 *   # 2. Apply to a disposable / explicitly chosen database (creates records; fills nothing unless --fill-empty).
 *   ... same ... --apply
 *
 *   # A remote (Turso) target is allowed only with its token in IMPORT_TARGET_TOKEN, the host in --expect-target, and for --apply also --allow-remote.
 *   IMPORT_TARGET_URL=libsql://<db>.turso.io IMPORT_TARGET_TOKEN=<token> npx tsx scripts/import-publications.ts --file ... --expect-target <db>.turso.io
 *
 * Options
 *   --file <path>              the .xlsx (required)
 *   --expect-target <id>       the file path (file:/abs/...) or the host the operator confirms; must equal the real target (required)
 *   --apply                    write (default: dry run)
 *   --allow-remote             required together with --apply for a remote database
 *   --visibility PUBLIC|LAB_ONLY   visibility of created records (default PUBLIC; use LAB_ONLY to stage them for review)
 *   --fill-empty               for a record that is already stored and IDENTICAL, fill only its EMPTY bibliographic fields
 *   --overrides <json>         decisions made by a person: values for blocked records and the numbers listed in confirmDistinct
 *   --report-dir <dir>         write report.md and report.json there
 *
 * The target comes ONLY from IMPORT_TARGET_URL / IMPORT_TARGET_TOKEN. DATABASE_URL, TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are never read, so an
 * ambient application credential cannot silently select the database. The token is read from the environment only and is never printed.
 * Nothing is ever deleted; no existing field is overwritten. See docs/architecture/publication-list-import.md.
 *
 * Exit codes: 0 finished (items needing a human decision are listed in the report, not an error); 1 some records failed to write; 2 refused before
 * touching the database (bad arguments / target / file); 4 unexpected error.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import type { Visibility } from "@scl/shared";
import { MigrationRefusal, parseTarget, redact } from "../src/lib/tursoMigrate.ts";
import type { ApplyResult, ImportSummary, Overrides } from "../src/lib/publicationImport/index.ts";

// The application's own Prisma client (src/lib/prisma.ts) is built from DATABASE_URL / TURSO_* when its module is first loaded, and the shared
// duplicate rules import it. This tool never uses that client, so those variables are removed BEFORE the library is loaded: an ambient
// application credential can neither select the target nor even configure a client. The tool's own client is built from IMPORT_TARGET_* only.
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
process.env.DATABASE_URL = "file:./unused-by-import.db";
const { XlsxError, applyPlan, buildJsonReport, buildMarkdownReport, buildPlan, loadExistingPublications } = await import("../src/lib/publicationImport/index.ts");

class Refusal extends Error {}

function parseArgs(argv: string[]) {
  const out = { file: "", expectTarget: "", apply: false, allowRemote: false, visibility: "PUBLIC" as Visibility, fillEmpty: false, overrides: "", reportDir: "", unknown: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--allow-remote") out.allowRemote = true;
    else if (a === "--fill-empty") out.fillEmpty = true;
    else if (a === "--file") out.file = argv[++i] ?? "";
    else if (a === "--expect-target") out.expectTarget = argv[++i] ?? "";
    else if (a === "--overrides") out.overrides = argv[++i] ?? "";
    else if (a === "--report-dir") out.reportDir = argv[++i] ?? "";
    else if (a === "--visibility") out.visibility = (argv[++i] ?? "") as Visibility;
    else out.unknown.push(a);
  }
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.IMPORT_TARGET_URL;
  const token = process.env.IMPORT_TARGET_TOKEN;
  const secrets = [token, url];
  try {
    if (args.unknown.length) throw new Refusal(`Unknown argument(s): ${args.unknown.join(" ")}`);
    if (!args.file) throw new Refusal("--file <path to the .xlsx> is required.");
    if (args.visibility !== "PUBLIC" && args.visibility !== "LAB_ONLY") throw new Refusal("--visibility must be PUBLIC or LAB_ONLY.");
    if (!fs.existsSync(args.file)) throw new Refusal("The --file does not exist.");

    const target = parseTarget({ url, authToken: token }, args.expectTarget);
    if (args.apply && target.kind === "remote" && !args.allowRemote) throw new Refusal("--apply to a REMOTE database also needs --allow-remote.");

    let overrides: Overrides | undefined;
    if (args.overrides) {
      try {
        overrides = JSON.parse(fs.readFileSync(args.overrides, "utf8")) as Overrides;
      } catch {
        throw new Refusal("The --overrides file is missing or is not valid JSON.");
      }
    }

    // A client for exactly the confirmed target. The schema's DATABASE_URL is not consulted for it.
    const db =
      target.kind === "remote"
        ? new PrismaClient({ adapter: new PrismaLibSQL(createClient({ url: target.url, authToken: target.authToken })) })
        : new PrismaClient({ datasources: { db: { url: target.url } } });
    try {
      const { rows, hasNewColumns } = await loadExistingPublications(db);
      if (args.apply && !hasNewColumns) throw new Refusal("The target has not had the migration 20261029120000_publication_bibliographic_fields yet. Apply it first (see the documentation); this tool never alters the schema.");

      const { parsed, plan } = buildPlan(fs.readFileSync(args.file), rows, overrides);
      for (const issue of parsed.issues) if (issue.level === "error") throw new Refusal(issue.message);

      let results: ApplyResult[] | undefined;
      if (args.apply) {
        results = await applyPlan(db, plan, { visibility: args.visibility, fillEmpty: args.fillEmpty, confirmDistinct: new Set(overrides?.confirmDistinct ?? []) });
      }
      const applied = results ? results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {}) : undefined;
      const summary: ImportSummary = {
        file: path.basename(args.file),
        target: target.identity,
        mode: args.apply ? "apply" : "dry-run",
        owner: parsed.owner,
        sheets: parsed.sheets,
        sourceRecords: parsed.records.filter((r) => !r.empty).length,
        emptyBlocks: parsed.records.filter((r) => r.empty).length,
        counts: plan.counts,
        applied,
      };
      const markdown = buildMarkdownReport(summary, plan, results);
      if (args.reportDir) {
        fs.mkdirSync(args.reportDir, { recursive: true });
        fs.writeFileSync(path.join(args.reportDir, "report.md"), markdown);
        fs.writeFileSync(path.join(args.reportDir, "report.json"), JSON.stringify(buildJsonReport(summary, plan, results), null, 2));
      }
      console.log(markdown.split("\n").slice(0, 24).join("\n"));
      console.log(`\n${args.reportDir ? `Full report: ${path.join(args.reportDir, "report.md")}` : "Use --report-dir to save the full report."}`);
      return results?.some((r) => r.outcome === "failed") ? 1 : 0;
    } finally {
      await db.$disconnect();
    }
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err), secrets);
    if (err instanceof Refusal || err instanceof MigrationRefusal || err instanceof XlsxError) {
      console.error(`REFUSED: ${message}`);
      return 2;
    }
    console.error(`ERROR: ${message}`);
    return 4;
  }
}

process.exitCode = await main();

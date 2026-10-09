/**
 * Auditable, idempotent publication import from a prepared MANIFEST (JSON) into a DISPOSABLE LOCAL SQLite database.
 *
 *   tsx scripts/publication-source-import.ts --manifest <file.json> --db <file.db> --i-confirm-disposable-local-database [--apply]
 *
 * Safety (all enforced before anything is opened for writing; dry run is the default and never writes):
 *  - the target must be a plain local file path OUTSIDE this repository, never `prisma/dev.db`, never a URL;
 *  - the file must carry the marker table `_disposable_import_target` (created by whoever provisions the disposable copy);
 *  - TURSO_* variables must be unset (this tool never talks to Turso; set variables mean the shell is pointed at a real database);
 *  - the migration must already be present (`PublicationSourceRecord` exists): this tool never migrates anything;
 *  - existing publications are never updated or deleted — a possible duplicate is only RECORDED next to the existing row.
 *
 * What it does with each source block (see PublicationSourceRecord in schema.prisma):
 *  - IMPORTED           a new Publication (year present, schema-valid, no duplicate), `sourceOrder` = position in the source list;
 *  - STAGED_NO_YEAR     no year in the source: nothing is invented — the block is kept in the provenance table only;
 *  - STAGED_INVALID     present but fails the normal publication validation (reason in `note`);
 *  - POSSIBLE_DUPLICATE the same DOI or the same normalised title already exists: NOT inserted, linked to the existing row.
 * Every block gets exactly one provenance row (verbatim source cells + derived values), keyed by `<file hash>:<sheet>:<first row>`,
 * so a second run creates nothing. The whole run is one transaction: any failure leaves the database untouched.
 *
 * The manifest (with the real data) lives OUTSIDE the repository; only this generic tool is committed.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { createPublicationSchema, doiKey, doiToUrl, normalizeDoi } from "@scl/shared";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..", "..");
export const MARKER_TABLE = "_disposable_import_target";

export interface ManifestField {
  column: string; // e.g. "C14"
  label: string; // the source's own label for the row (verbatim)
  value: string | null; // verbatim cell text
}
export interface ManifestRecord {
  sheet: string;
  rowStart: number;
  rowEnd: number;
  seq: number;
  fields: ManifestField[];
  publication: { year: number | null; title: string; authors: string; venue: string; doi: string | null; visibility: "PUBLIC" | "LAB_ONLY" };
  warnings: string[];
}
export interface Manifest {
  format: "publication-import-manifest/1";
  batchId: string;
  sourceFile: string;
  sourceSha256: string;
  records: ManifestRecord[];
}

export type Disposition = "IMPORTED" | "STAGED_NO_YEAR" | "STAGED_INVALID" | "POSSIBLE_DUPLICATE";
export interface PlanRow {
  seq: number;
  sheet: string;
  rows: string;
  sourceKey: string;
  disposition: Disposition;
  publicationId: string | null; // existing row it may duplicate, or (after apply) the created one
  note: string;
  action: "create-publication" | "provenance-only" | "already-imported";
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const lineBreaksToSlash = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " / ");
const normTitle = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Dice coefficient on character bigrams of the normalised titles (0..1). Only ever used to FLAG, never as a key. */
export function titleSimilarity(a: string, b: string): number {
  const x = normTitle(a);
  const y = normTitle(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const gx = grams(x);
  const gy = grams(y);
  let hit = 0;
  for (const [g, n] of gx) hit += Math.min(n, gy.get(g) ?? 0);
  return (2 * hit) / (x.length - 1 + (y.length - 1));
}

export const sourceKeyOf = (m: Pick<Manifest, "sourceSha256">, r: Pick<ManifestRecord, "sheet" | "rowStart">) => `${m.sourceSha256.slice(0, 16)}:${r.sheet}:${r.rowStart}`;

export interface TargetCheck {
  ok: boolean;
  reason?: string;
  resolved?: string;
}

/** Everything that must hold before the file is opened. Pure (filesystem reads only), so it is unit-tested. */
export function checkTargetPath(dbArg: string | undefined, env: NodeJS.ProcessEnv = process.env): TargetCheck {
  if (!dbArg) return { ok: false, reason: "--db <file> is required." };
  if (/^[a-z][a-z0-9+.-]*:/i.test(dbArg) && !/^[a-z]:[\\/]/i.test(dbArg)) return { ok: false, reason: "--db must be a plain local file path, not a URL." };
  if (env.TURSO_DATABASE_URL || env.TURSO_AUTH_TOKEN) return { ok: false, reason: "TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are set in this shell. Unset them: this tool never touches Turso." };
  const resolved = path.resolve(dbArg);
  const rel = path.relative(REPO_ROOT, resolved);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return { ok: false, reason: "The target must be OUTSIDE the repository (this also excludes prisma/dev.db)." };
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return { ok: false, reason: "The target file does not exist (create the disposable copy first; this tool never creates a database)." };
  if (!/\.(db|sqlite|sqlite3)$/i.test(resolved)) return { ok: false, reason: "The target must be a .db/.sqlite file." };
  return { ok: true, resolved };
}

export interface RunOptions {
  apply: boolean;
  now?: Date;
}

export interface RunResult {
  plan: PlanRow[];
  applied: boolean;
  counts: Record<string, number>;
}

/** Plan (and, with `apply`, execute) the import against an already-open disposable client. */
export async function runImport(prisma: PrismaClient, manifest: Manifest, opts: RunOptions): Promise<RunResult> {
  if (manifest.format !== "publication-import-manifest/1") throw new Error("Unsupported manifest format.");
  if (!/^[0-9a-f]{64}$/.test(manifest.sourceSha256)) throw new Error("Manifest sourceSha256 must be a 64-character hex digest.");
  const seqs = manifest.records.map((r) => r.seq);
  if (new Set(seqs).size !== seqs.length) throw new Error("Manifest sequence numbers are not unique.");
  const keys = manifest.records.map((r) => sourceKeyOf(manifest, r));
  if (new Set(keys).size !== keys.length) throw new Error("Two manifest records share a source key.");

  const now = opts.now ?? new Date();
  const result: RunResult = { plan: [], applied: false, counts: {} };

  const body = async (tx: Pick<PrismaClient, "publication" | "publicationSourceRecord" | "auditLog">, write: boolean) => {
    const existingKeys = new Set((await tx.publicationSourceRecord.findMany({ where: { sourceKey: { in: keys } }, select: { sourceKey: true } })).map((r) => r.sourceKey));
    const pubs = (await tx.publication.findMany({ select: { id: true, title: true, doiUrl: true, year: true } })).map((p) => ({ id: p.id, title: p.title, doiKey: doiKey(normalizeDoi(p.doiUrl) ?? "") || null, year: p.year }));

    for (const rec of manifest.records.slice().sort((a, b) => a.seq - b.seq)) {
      const sourceKey = sourceKeyOf(manifest, rec);
      const rows = `${rec.rowStart}-${rec.rowEnd}`;
      if (existingKeys.has(sourceKey)) {
        result.plan.push({ seq: rec.seq, sheet: rec.sheet, rows, sourceKey, disposition: "IMPORTED", publicationId: null, note: "already imported by an earlier run (nothing done)", action: "already-imported" });
        continue;
      }
      const p = rec.publication;
      const doi = p.doi ? normalizeDoi(p.doi) : null;
      const cleaned = { title: collapse(p.title), authors: collapse(p.authors), venue: collapse(lineBreaksToSlash(p.venue)) };
      const changes = (["title", "authors", "venue"] as const).filter((k) => cleaned[k] !== p[k]);
      const notes: string[] = [];
      if (p.doi && !doi) notes.push(`DOI "${p.doi}" is not a valid DOI and was not used`);
      if (changes.length) notes.push(`whitespace/line breaks normalised in: ${changes.join(", ")} (originals kept in rawFields)`);

      // duplicates: exact DOI or exact normalised title (and, for information only, a near-identical title)
      let dupOf: { id: string; why: string } | null = null;
      const near: string[] = [];
      for (const e of pubs) {
        if (doi && e.doiKey && e.doiKey === doiKey(doi)) dupOf ??= { id: e.id, why: `same DOI as ${e.id}${e.year !== p.year ? ` (existing year ${e.year}, source year ${p.year ?? "none"})` : ""}` };
        else if (normTitle(e.title) === normTitle(cleaned.title)) dupOf ??= { id: e.id, why: `identical title to ${e.id} (existing year ${e.year}, source year ${p.year ?? "none"})` };
        else if (titleSimilarity(e.title, cleaned.title) >= 0.8) near.push(`${e.id} (${titleSimilarity(e.title, cleaned.title).toFixed(2)})`);
      }
      if (near.length) notes.push(`similar title to existing: ${near.join(", ")}`);

      let disposition: Disposition;
      let publicationId: string | null = null;
      let action: PlanRow["action"] = "provenance-only";
      let data: Parameters<typeof tx.publication.create>[0]["data"] | null = null;

      if (p.year === null) {
        disposition = "STAGED_NO_YEAR";
        notes.unshift("no year in the source; none invented — kept in the provenance table until a year is supplied");
        if (dupOf) {
          notes.push(`possible duplicate: ${dupOf.why}`);
          publicationId = dupOf.id;
        }
      } else if (dupOf) {
        disposition = "POSSIBLE_DUPLICATE";
        publicationId = dupOf.id;
        notes.unshift(`possible duplicate: ${dupOf.why}; NOT inserted and the existing record is untouched`);
      } else {
        const parsed = createPublicationSchema.safeParse({ year: p.year, title: cleaned.title, authors: cleaned.authors, venue: cleaned.venue, doiUrl: doi ?? "", visibility: p.visibility });
        if (!parsed.success) {
          disposition = "STAGED_INVALID";
          notes.unshift(`fails publication validation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        } else {
          disposition = "IMPORTED";
          action = "create-publication";
          data = {
            year: parsed.data.year,
            title: parsed.data.title,
            authors: parsed.data.authors,
            venue: parsed.data.venue,
            doiUrl: doi ? doiToUrl(doi) : "",
            visibility: parsed.data.visibility ?? "PUBLIC",
            sourceOrder: rec.seq,
            // Default listing is `createdAt desc` inside a year; a later position gets an earlier stamp, so the source order shows within each year.
            createdAt: new Date(now.getTime() - rec.seq * 1000),
          };
        }
      }

      const note = notes.join("; ");
      if (write) {
        if (data) {
          const created = await tx.publication.create({ data, select: { id: true } });
          publicationId = created.id;
          pubs.push({ id: created.id, title: cleaned.title, doiKey: doi ? doiKey(doi) : null, year: p.year });
          await tx.auditLog.create({ data: { actorId: null, actorEmail: "publication-source-import", action: "PUBLICATION_CREATED", entityType: "PUBLICATION", entityId: created.id, details: JSON.stringify({ source: sourceKey, seq: rec.seq }) } });
        }
        await tx.publicationSourceRecord.create({
          data: {
            sourceKey,
            batchId: manifest.batchId,
            sourceFile: path.basename(manifest.sourceFile),
            sourceSha256: manifest.sourceSha256,
            sourceSheet: rec.sheet,
            sourceRowStart: rec.rowStart,
            sourceRowEnd: rec.rowEnd,
            sourceSeq: rec.seq,
            disposition,
            publicationId,
            note,
            rawFields: JSON.stringify(rec.fields),
            normalized: JSON.stringify({ proposed: { ...p, ...cleaned, doi }, warnings: rec.warnings }),
          },
        });
      } else if (data) {
        // dry run: remember it so later blocks of the same file are compared against it
        pubs.push({ id: `(new #${rec.seq})`, title: cleaned.title, doiKey: doi ? doiKey(doi) : null, year: p.year });
      }
      result.plan.push({ seq: rec.seq, sheet: rec.sheet, rows, sourceKey, disposition, publicationId, note, action });
    }
  };

  if (opts.apply) {
    await prisma.$transaction(async (tx) => body(tx as never, true), { timeout: 120_000, maxWait: 20_000 });
    result.applied = true;
  } else {
    await body(prisma, false);
  }
  for (const r of result.plan) {
    const k = r.action === "already-imported" ? "ALREADY_IMPORTED" : r.disposition;
    result.counts[k] = (result.counts[k] ?? 0) + 1;
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const apply = args.includes("--apply");
  if (!args.includes("--i-confirm-disposable-local-database")) {
    console.error("Refusing to run: pass --i-confirm-disposable-local-database (and --db <a disposable local .db file>).");
    process.exit(2);
  }
  const target = checkTargetPath(get("--db"));
  if (!target.ok) {
    console.error(`Refusing to run: ${target.reason}`);
    process.exit(2);
  }
  const manifestPath = get("--manifest");
  if (!manifestPath || !existsSync(manifestPath)) {
    console.error("Refusing to run: --manifest <file.json> is required and must exist.");
    process.exit(2);
  }
  const rel = path.relative(REPO_ROOT, path.resolve(manifestPath));
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    console.error("Refusing to run: keep the manifest (it holds the real publication data) outside the repository.");
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

  const prisma = new PrismaClient({ datasourceUrl: `file:${target.resolved}`, log: ["error"] });
  try {
    const marker = (await prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='${MARKER_TABLE}'`)) as { n: number | bigint }[];
    if (Number(marker[0]?.n) !== 1) throw new Error(`The target lacks the ${MARKER_TABLE} marker table, so it is not declared disposable.`);
    const hasTable = (await prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='PublicationSourceRecord'`)) as { n: number | bigint }[];
    if (Number(hasTable[0]?.n) !== 1) throw new Error("The target has not had migration 20261009100000_publication_source_provenance applied. This tool never migrates.");
    console.log(`Target: ${path.basename(target.resolved!)} (marker present, migration present, outside the repository). Mode: ${apply ? "APPLY" : "DRY RUN (no writes)"}`);
    const res = await runImport(prisma, manifest, { apply });
    for (const r of res.plan) console.log(`#${String(r.seq).padStart(2)} ${r.sheet}:${r.rows}  ${r.disposition.padEnd(18)} ${r.action.padEnd(18)} ${r.publicationId ?? "-"}  ${r.note}`);
    console.log("Counts:", JSON.stringify(res.counts));
    console.log(res.applied ? "Applied in one transaction." : "Nothing was written.");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Import failed: ${(err as Error).message}`);
    process.exit(1);
  });
}

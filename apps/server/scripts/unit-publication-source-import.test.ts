/**
 * Checks for the spreadsheet-provenance importer (scripts/publication-source-import.ts) on SYNTHETIC data and a
 * disposable temp copy of the seeded dev database (the real dev.db is only read, to make the copy). No network, no Turso.
 *
 *   tsx scripts/unit-publication-source-import.test.ts
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { MARKER_TABLE, checkTargetPath, runImport, sourceKeyOf, titleSimilarity, visibilityFor, describeDifferences, type Manifest, type ManifestRecord } from "./publication-source-import.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const work = mkdtempSync(path.join(os.tmpdir(), "scl-pubsrc-"));
const dbFile = path.join(work, "import-target.db");
copyFileSync(DEV_DB, dbFile);

const SHA = "a".repeat(64);
const rec = (seq: number, over: Partial<ManifestRecord["publication"]> = {}, extra: Partial<ManifestRecord> = {}): ManifestRecord => ({
  sheet: "Sheet1",
  rowStart: 7 + (seq - 1) * 10,
  rowEnd: 16 + (seq - 1) * 10,
  seq,
  fields: [{ column: `C${7 + (seq - 1) * 10}`, label: "著者", value: `Author ${seq}` }],
  publication: { year: 2020 + (seq % 5), title: `ZZ Synthetic Title Number ${seq} about widgets`, authors: `Author ${seq}`, venue: `ZZ Venue ${seq}`, doi: null, status: "出版", ...over },
  warnings: [],
  ...extra,
});
const manifest = (records: ManifestRecord[]): Manifest => ({ format: "publication-import-manifest/1", batchId: "test-batch", sourceFile: "/some/dir/list.xlsx", sourceSha256: SHA, records });

async function main() {
  // ---- target safety (pure) ---------------------------------------------------------------------------------------------------
  t("target: missing --db is refused", !checkTargetPath(undefined, {}).ok);
  t("target: a libsql URL is refused", !checkTargetPath("libsql://x.example.turso.io", {}).ok);
  t("target: a file: URL is refused", !checkTargetPath("file:/tmp/x.db", {}).ok);
  t("target: the repo's dev.db is refused", /OUTSIDE the repository/.test(checkTargetPath(DEV_DB, {}).reason ?? ""));
  t("target: any path inside the repo is refused", !checkTargetPath(path.join(SERVER_ROOT, "x.db"), {}).ok);
  t("target: TURSO_* set -> refused even for a good path", /TURSO/.test(checkTargetPath(dbFile, { TURSO_DATABASE_URL: "libsql://x" }).reason ?? ""));
  t("target: a nonexistent file is refused (the tool never creates a database)", !checkTargetPath(path.join(work, "nope.db"), {}).ok);
  t("target: a good disposable path outside the repo is accepted", checkTargetPath(dbFile, {}).ok);

  t("visibility: 出版 is PUBLIC", visibilityFor("出版").visibility === "PUBLIC" && !visibilityFor(" 出版 ").ambiguous);
  t("visibility: 投稿中 and 受理 are LAB_ONLY and not ambiguous", ["投稿中", "受理"].every((s) => visibilityFor(s).visibility === "LAB_ONLY" && !visibilityFor(s).ambiguous));
  t("visibility: blank, null and unknown are LAB_ONLY and flagged ambiguous", [null, "", "  ", "Published", "出版済"].every((s) => visibilityFor(s).visibility === "LAB_ONLY" && visibilityFor(s).ambiguous));
  t("visibility: a manifest can never make a non-出版 record PUBLIC, only more private", visibilityFor("受理", "PUBLIC").visibility === "LAB_ONLY" && visibilityFor("出版", "LAB_ONLY").visibility === "LAB_ONLY");
  t("similarity: identical", titleSimilarity("A b c", "a  B, c") === 1);
  t("similarity: unrelated is low", titleSimilarity("graphene transistors", "wafer test coverage") < 0.4);

  const prisma = new PrismaClient({ datasourceUrl: `file:${dbFile}`, log: ["error"] });
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (note TEXT)`);
    const seeded = await prisma.publication.findMany({ select: { id: true, title: true, doiUrl: true, year: true } });
    t("setup: the disposable copy has seeded publications to compare against", seeded.length >= 2);
    const seedDoi = seeded.find((p) => p.doiUrl)!;
    const before = JSON.stringify(await prisma.publication.findMany({ orderBy: { id: "asc" } }));

    const records: ManifestRecord[] = [
      rec(1, { year: 2024, doi: "https://doi.org/10.9999/ZZ.One" }), //                      -> IMPORTED
      rec(2, { year: null }), //                                                               -> STAGED_NO_YEAR
      rec(3, { year: 2022, doi: seedDoi.doiUrl, title: "ZZ A different title for the same DOI" }), // -> POSSIBLE_DUPLICATE (DOI)
      rec(4, { year: 2021, title: seeded[0].title.toUpperCase() + "!" }), //                  -> POSSIBLE_DUPLICATE (title)
      rec(5, { year: 2023, title: "", authors: "A" }), //                                       -> STAGED_INVALID
      rec(6, { year: 2020, venue: "ZZ Journal\nCONF 2024  ", title: "ZZ   spaced   title six" }), // -> IMPORTED (normalised)
      rec(7, { year: 2020, doi: "10.9999/zz.one", title: "ZZ another title seven" }), //     -> POSSIBLE_DUPLICATE of #1 (same DOI, case-insensitive)
      rec(8, { year: 2020, status: "投稿中", doi: "not a doi" }), //                     -> IMPORTED, bad DOI noted & not used
      rec(9, { year: null, doi: seedDoi.doiUrl }),
      rec(10, { year: 2017, status: null, doi: "10.9999/zz.published.looking", title: "ZZ blank status title ten" }), // -> IMPORTED as LAB_ONLY, flagged ambiguous //                                          -> STAGED_NO_YEAR with duplicate note
    ];
    const m = manifest(records);

    // ---- dry run writes nothing --------------------------------------------------------------------------------------------------
    const dry = await runImport(prisma, m, { apply: false });
    t("dry run: nothing written", JSON.stringify(await prisma.publication.findMany({ orderBy: { id: "asc" } })) === before && (await prisma.publicationSourceRecord.count()) === 0);
    t("dry run: plan accounts for every block exactly once", dry.plan.length === 10 && new Set(dry.plan.map((p) => p.seq)).size === 10);

    // ---- apply -------------------------------------------------------------------------------------------------------------------
    const now = new Date("2030-01-01T00:00:00Z");
    const res = await runImport(prisma, m, { apply: true, now });
    const by = Object.fromEntries(res.plan.map((p) => [p.seq, p]));
    t("apply: dispositions as designed", [1, 6, 8, 10].every((s) => by[s].disposition === "IMPORTED") && by[2].disposition === "STAGED_NO_YEAR" && [3, 4, 7].every((s) => by[s].disposition === "POSSIBLE_DUPLICATE") && by[5].disposition === "STAGED_INVALID" && by[9].disposition === "STAGED_NO_YEAR", JSON.stringify(res.counts));
    t("apply: counts add up to every source block", Object.values(res.counts).reduce((a, b) => a + b, 0) === 10);
    t("apply: one provenance row per block, mapped by sheet/rows/seq", (await prisma.publicationSourceRecord.count()) === 10 && (await prisma.publicationSourceRecord.count({ where: { sourceSeq: 6, sourceRowStart: 57, sourceRowEnd: 66, sourceSheet: "Sheet1" } })) === 1);
    const after = await prisma.publication.findMany({ orderBy: { id: "asc" } });
    t("apply: exactly the 4 IMPORTED blocks became publications", after.length === seeded.length + 4);
    t("apply: existing publications are byte-identical (never updated or deleted)", JSON.stringify(after.filter((p) => seeded.some((s) => s.id === p.id))) === before);
    const imported = await prisma.publication.findMany({ where: { sourceOrder: { not: null } }, orderBy: { sourceOrder: "asc" } });
    t("apply: sourceOrder holds the source position and reproduces the source order", imported.map((p) => p.sourceOrder).join() === "1,6,8,10");
    t("apply: DOI stored canonically; an invalid DOI is not used", imported[0].doiUrl === "https://doi.org/10.9999/ZZ.One" && imported[2].doiUrl === "" && /not a valid DOI/.test(by[8].note));
    t("apply: whitespace/line breaks normalised, original kept verbatim in rawFields", imported[1].venue === "ZZ Journal / CONF 2024" && imported[1].title === "ZZ spaced title six" && (await prisma.publicationSourceRecord.findUnique({ where: { sourceKey: sourceKeyOf(m, records[5]) } }))?.rawFields.includes("Author 6") === true);
    t("apply: visibility comes from the status only (出版 -> PUBLIC, 投稿中 -> LAB_ONLY)", imported[2].visibility === "LAB_ONLY" && imported[0].visibility === "PUBLIC" && imported[3].visibility === "LAB_ONLY" && /needs review/.test(by[10].note) && imported[3].doiUrl !== "", "a DOI, a year and a venue never turn a blank status into PUBLIC");
    t("apply: the verbatim status is kept in provenance", JSON.parse((await prisma.publicationSourceRecord.findUnique({ where: { sourceKey: sourceKeyOf(m, records[7]) } }))!.normalized).statusVerbatim === "投稿中");
    const listed = await prisma.publication.findMany({ where: { sourceOrder: { in: [6, 8] } }, orderBy: [{ year: "desc" }, { createdAt: "desc" }, { id: "asc" }] });
    t("apply: within one year the DEFAULT public order (year desc, createdAt desc) shows imported rows in source order", listed.map((p) => p.sourceOrder).join() === "6,8", listed.map((p) => `${p.year}/${p.sourceOrder}`).join());
    t("apply: a duplicate is linked to the EXISTING row (not inserted)", by[3].publicationId === seedDoi.id && by[4].publicationId === seeded[0].id);
    t("apply: a duplicate's note lists the field-level differences (here the year and title) and changes nothing", /differences for review: year \(existing \d+, source 2022\) — investigate/.test(by[3].note) && /title/.test(by[3].note), by[3].note);
    t("apply: an unchanged-after-normalisation duplicate says so", describeDifferences({ year: 2020, title: "A  b", authors: "X, Y.", venue: "V" }, { year: 2020, title: "a b", authors: "x y", venue: "v" }).startsWith("no field differs"));
    t("apply: a within-file duplicate is linked to the earlier imported row", by[7].publicationId === imported[0].id);
    t("apply: a no-year block keeps its duplicate hint but creates nothing", by[9].publicationId === seedDoi.id && /possible duplicate/.test(by[9].note));
    t("apply: every block has a unique source key", new Set((await prisma.publicationSourceRecord.findMany({ select: { sourceKey: true } })).map((r) => r.sourceKey)).size === 10);
    t("apply: audit rows exist for the created publications only", (await prisma.auditLog.count({ where: { actorEmail: "publication-source-import" } })) === 4);

    // ---- idempotent --------------------------------------------------------------------------------------------------------------
    const again = await runImport(prisma, m, { apply: true, now });
    t("rerun: creates nothing (all 10 already imported)", again.counts.ALREADY_IMPORTED === 10 && (await prisma.publication.count()) === after.length && (await prisma.publicationSourceRecord.count()) === 10);

    // ---- atomic: a failure midway leaves nothing behind ----------------------------------------------------------------------
    const pubsBefore = await prisma.publication.count();
    const provBefore = await prisma.publicationSourceRecord.count();
    const bad = rec(12, {}, { rowStart: 507, rowEnd: 516, fields: [{ column: "C507", label: "x", value: 1n as unknown as string }] }); // BigInt cannot be JSON-serialised -> fails after #11 was created
    const good = rec(11, { year: 2018 }, { rowStart: 497, rowEnd: 506 });
    let failed = false;
    try {
      await runImport(prisma, { ...manifest([good, bad]), sourceSha256: "b".repeat(64) }, { apply: true, now });
    } catch {
      failed = true;
    }
    t("rollback: the failing run throws", failed);
    t("rollback: no publication and no provenance row survives", (await prisma.publication.count()) === pubsBefore && (await prisma.publicationSourceRecord.count()) === provBefore);

    // ---- manifest validation ---------------------------------------------------------------------------------------------------
    const rejects = async (mm: Manifest) => runImport(prisma, mm, { apply: false }).then(() => false, () => true);
    t("manifest: duplicate sequence numbers are refused", await rejects(manifest([rec(1), rec(1)])));
    t("manifest: a bad hash is refused", await rejects({ ...manifest([rec(1)]), sourceSha256: "zz" }));
    t("manifest: an unknown format is refused", await rejects({ ...manifest([rec(1)]), format: "x" as never }));
  } finally {
    await prisma.$disconnect();
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`${ok} publication-source-import checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

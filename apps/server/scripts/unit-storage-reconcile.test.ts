/**
 * Unit test of the Phase 26 storage reconciler (lib/storageReconcile.ts). No real server, no real
 * database — a disposable temp directory stands in for STORAGE_ROOT and a minimal in-memory fake
 * stands in for the `storedFile` Prisma delegate (both accepted as explicit overrides so this test
 * never touches the real dev.db or STORAGE_DIR).   npm run test:unit -w apps/server
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { reconcileStorage } from "../src/lib/storageReconcile.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

const dir = mkdtempSync(path.join(tmpdir(), "scl-storage-reconcile-test-"));

function writeBlob(key: string, ageMs = 0) {
  const p = path.join(dir, key);
  writeFileSync(p, "fake blob bytes");
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    utimesSync(p, past, past);
  }
  return p;
}

// A: no DB row, old enough to count as orphaned.
const keyOrphanNoRow = randomUUID();
writeBlob(keyOrphanNoRow, 2 * 60 * 60 * 1000); // 2h old

// B: no DB row, written "just now" — must be left alone (could be an in-flight upload).
const keySkippedRecent = randomUUID();
writeBlob(keySkippedRecent, 0);

// C: DB row exists and is soft-deleted (deletedAt set) — safe to delete regardless of age.
const keyOrphanSoftDeleted = randomUUID();
writeBlob(keyOrphanSoftDeleted, 0);

// D: DB row exists and is live — must never be touched or reported.
const keyLive = randomUUID();
writeBlob(keyLive, 5 * 60 * 60 * 1000);

// E: a stray, non-UUID file — must be completely ignored (not scanned, counted, or deleted).
writeFileSync(path.join(dir, "notes.txt"), "not a storage key");

// F: a live DB row whose blob does not exist on disk at all.
const keyMissingBlob = randomUUID();

const fakeRows = [
  { id: "row-c", storageKey: keyOrphanSoftDeleted, deletedAt: new Date() },
  { id: "row-d", storageKey: keyLive, deletedAt: null },
  { id: "row-f", storageKey: keyMissingBlob, deletedAt: null },
];
const fakePrisma = {
  storedFile: {
    findMany: async () => fakeRows,
  },
} as unknown as Pick<PrismaClient, "storedFile">;

async function main() {
  // ---- dry run: report only, nothing on disk changes ----------------------------------------------
  const graceMs = 60 * 60 * 1000; // 1h
  const dryReport = await reconcileStorage({ storageRoot: dir, graceMs, prisma: fakePrisma, delete: false });

  t("scannedFiles counts only valid UUID-named blobs on disk (4), never the stray notes.txt", dryReport.scannedFiles === 4);
  t("liveRows counts only non-deleted DB rows (2)", dryReport.liveRows === 2);
  t("the old no-row blob is reported as orphanedNoRow", dryReport.orphanedNoRow.includes(keyOrphanNoRow));
  t("the fresh no-row blob is reported as skippedRecent, not orphanedNoRow", dryReport.skippedRecent.includes(keySkippedRecent) && !dryReport.orphanedNoRow.includes(keySkippedRecent));
  t("the soft-deleted row's blob is reported as orphanedSoftDeleted", dryReport.orphanedSoftDeleted.includes(keyOrphanSoftDeleted));
  t("the live row's blob is reported nowhere (not orphaned, not missing)", ![...dryReport.orphanedNoRow, ...dryReport.orphanedSoftDeleted, ...dryReport.skippedRecent].includes(keyLive));
  t("the live row with a missing blob is reported in missingBlobs", dryReport.missingBlobs.some((r) => r.storageKey === keyMissingBlob));
  t("dry run deletes nothing (deleted is empty)", dryReport.deleted.length === 0);
  t("dry run leaves the orphaned-no-row blob on disk", existsSync(path.join(dir, keyOrphanNoRow)));
  t("dry run leaves the soft-deleted-row blob on disk", existsSync(path.join(dir, keyOrphanSoftDeleted)));
  t("the stray non-UUID file is never touched or removed", existsSync(path.join(dir, "notes.txt")));

  // ---- real run: --delete actually removes only the two safe orphan categories --------------------
  const deleteReport = await reconcileStorage({ storageRoot: dir, graceMs, prisma: fakePrisma, delete: true });
  t("delete run removes exactly the two safe orphans", deleteReport.deleted.sort().join(",") === [keyOrphanNoRow, keyOrphanSoftDeleted].sort().join(","));
  t("the orphaned-no-row blob is now actually gone from disk", !existsSync(path.join(dir, keyOrphanNoRow)));
  t("the soft-deleted-row blob is now actually gone from disk", !existsSync(path.join(dir, keyOrphanSoftDeleted)));
  t("the fresh no-row blob (still within grace) survives a --delete run", existsSync(path.join(dir, keySkippedRecent)));
  t("the live row's blob survives a --delete run", existsSync(path.join(dir, keyLive)));
  t("the stray non-UUID file survives a --delete run", existsSync(path.join(dir, "notes.txt")));

  // ---- a missing STORAGE_ROOT is handled as "nothing on disk", not an unhandled crash -------------
  const missingDir = path.join(dir, "does-not-exist");
  const emptyReport = await reconcileStorage({ storageRoot: missingDir, prisma: { storedFile: { findMany: async () => [] } } as unknown as typeof fakePrisma });
  t("a missing storage root is treated as zero files on disk, not an error", emptyReport.scannedFiles === 0);

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${ok} storage-reconcile unit checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main();

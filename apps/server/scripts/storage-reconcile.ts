/**
 * CLI for the Phase 26 storage reconciler (src/lib/storageReconcile.ts). Dry-run by default —
 * reports what it finds and changes nothing. Pass --delete to actually remove the two orphan
 * categories it can safely repair (see storageReconcile.ts for exactly what those are and why the
 * third category, a live row with a missing blob, is never auto-repaired).
 *
 *   npm run storage:reconcile -w apps/server            # report only
 *   npm run storage:reconcile -w apps/server -- --delete  # report AND delete safe orphans
 */
import "dotenv/config";
import { reconcileStorage } from "../src/lib/storageReconcile.js";
import { prisma } from "../src/lib/prisma.js";

const doDelete = process.argv.includes("--delete");

async function main() {
  const report = await reconcileStorage({ delete: doDelete });

  console.log(`Scanned ${report.scannedFiles} blob(s) on disk; ${report.liveRows} live StoredFile row(s) in the database.`);
  console.log(`\nOrphaned (no DB row at all, past the grace period): ${report.orphanedNoRow.length}`);
  for (const key of report.orphanedNoRow) console.log(`  - ${key}`);
  console.log(`\nOrphaned (DB row is soft-deleted, blob was never removed): ${report.orphanedSoftDeleted.length}`);
  for (const key of report.orphanedSoftDeleted) console.log(`  - ${key}`);
  console.log(`\nSkipped (no DB row, but written too recently to distinguish from an in-flight upload): ${report.skippedRecent.length}`);
  console.log(`\nLive DB rows whose blob is MISSING on disk (needs manual investigation, never auto-repaired): ${report.missingBlobs.length}`);
  for (const row of report.missingBlobs) console.log(`  - StoredFile ${row.id} (storageKey ${row.storageKey})`);

  if (doDelete) {
    console.log(`\nDeleted ${report.deleted.length} orphaned blob(s).`);
  } else if (report.orphanedNoRow.length + report.orphanedSoftDeleted.length > 0) {
    console.log(`\nDry run only — re-run with --delete to remove the ${report.orphanedNoRow.length + report.orphanedSoftDeleted.length} orphan(s) listed above.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

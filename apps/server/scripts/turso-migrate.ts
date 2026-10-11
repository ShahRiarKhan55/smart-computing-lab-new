/**
 * Applies the reviewed gallery multi-image migrations to a libSQL/Turso database (or a local SQLite file).
 * See docs/architecture/turso-migration-executor.md for the full procedure, recovery notes and the limits of
 * what this tool can prove.
 *
 *   MIGRATE_TARGET_URL=libsql://<db>.turso.io MIGRATE_TARGET_TOKEN=<token> \
 *     npx tsx scripts/turso-migrate.ts --expect-target <db>.turso.io            # inspect only (default)
 *   ... same ... --expect-target <db>.turso.io --recovery-point 2026-10-12T01:30:00Z --apply
 *   MIGRATE_TARGET_URL=file:/abs/path/copy.db npx tsx scripts/turso-migrate.ts --expect-target file:/abs/path/copy.db --apply
 *
 * The target comes ONLY from MIGRATE_TARGET_URL / MIGRATE_TARGET_TOKEN. TURSO_DATABASE_URL / TURSO_AUTH_TOKEN and
 * DATABASE_URL are never read, so an ambient application credential cannot silently select the target. The token
 * is read from the environment only (never a flag) and is never printed. `--expect-target` is mandatory even for
 * inspection and must equal the target's real identity (host, or file path) exactly.
 *
 * Exit codes: 0 ok / nothing to do / planned; 2 refused before touching the database (bad target, hash mismatch,
 * unsafe state); 3 verification or COMMIT problem; 4 unexpected error.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MigrationRefusal,
  assertRecoveryPoint,
  execute,
  loadReviewedMigrations,
  openTarget,
  parseTarget,
  redact,
  type MigrationState,
} from "../src/lib/tursoMigrate.ts";

function parseArgs(argv: string[]) {
  const out: { apply: boolean; expectTarget?: string; recoveryPoint?: string; unknown: string[] } = { apply: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--expect-target") out.expectTarget = argv[++i];
    else if (a === "--recovery-point") out.recoveryPoint = argv[++i];
    else out.unknown.push(a);
  }
  return out;
}

const line = (s: MigrationState) =>
  `  ${s.name}: ${s.status}${s.missing.length ? `  missing=[${s.missing.join(", ")}]` : ""}${s.differing.length ? `  different=[${s.differing.join(", ")}]` : ""}${s.unexpected.length ? `  unexpected=[${s.unexpected.join(", ")}]` : ""}`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.MIGRATE_TARGET_URL;
  const token = process.env.MIGRATE_TARGET_TOKEN;
  const secrets = [token, url];
  try {
    if (args.unknown.length) throw new MigrationRefusal(`Unknown argument(s): ${args.unknown.join(" ")}`, "TARGET");
    if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
      console.log("Note: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are set in this environment and are IGNORED. Only MIGRATE_TARGET_* selects the target.");
    }
    const target = parseTarget({ url, authToken: token }, args.expectTarget);
    const migrations = loadReviewedMigrations(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations"));
    console.log(`Target identity : ${target.identity} (${target.kind})`);
    console.log(`Mode            : ${args.apply ? "APPLY" : "inspect only"}`);
    if (args.apply && target.kind === "remote") {
      const rp = assertRecoveryPoint(args.recoveryPoint, new Date());
      console.log(`Recovery point  : ${rp.toISOString()} (stated by the operator; not verified by this tool)`);
    }
    console.log(`Started (UTC)   : ${new Date().toISOString()}`);
    const client = openTarget(target);
    try {
      const report = await execute(client, migrations, { apply: args.apply });
      console.log("State before:");
      report.before.forEach((s) => console.log(line(s)));
      console.log("Row counts before:", JSON.stringify(report.countsBefore));
      if (report.outcome === "planned") console.log(`PLAN: ${migrations.filter((_, i) => report.before[i].status === "absent").map((m) => m.name).join(", ")} would be applied. Re-run with --apply to apply.`);
      if (report.outcome === "nothing-to-do") console.log("Nothing to do: every reviewed migration is already fully applied with the expected schema.");
      if (report.outcome === "applied" || report.outcome === "applied-after-commit-error") {
        console.log("State after:");
        report.after.forEach((s) => console.log(line(s)));
        console.log("Row counts after :", JSON.stringify(report.countsAfter));
        console.log(`APPLIED: ${report.appliedMigrations.join(", ")}${report.outcome === "applied-after-commit-error" ? "  (COMMIT reported an error but the schema was verified as applied)" : ""}`);
      }
      console.log(`Finished (UTC)  : ${new Date().toISOString()}`);
      return 0;
    } finally {
      client.close();
    }
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err), secrets);
    if (err instanceof MigrationRefusal) {
      console.error(`REFUSED [${err.code}]: ${message}`);
      return err.code === "VERIFY" || err.code === "COMMIT" ? 3 : 2;
    }
    console.error(`ERROR: ${message}`);
    return 4;
  }
}

process.exitCode = await main();

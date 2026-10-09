/**
 * OWNER-RUN, READ-ONLY check of the DB_SCHEMA_BEHIND guard against a REAL remote Turso database that is DISPOSABLE
 * (a separate database created for this purpose, e.g. `turso db create scl-guard-test --from-file <pre-phase27.db>`).
 * It sends only the guard's static SELECT probes (no writes, no DDL) and prints a verdict plus the redacted error text, so the
 * real server wording can be compared with what the guard expects. It never reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.
 *
 *   TURSO_GUARD_TEST_URL=libsql://<disposable-db>.turso.io TURSO_GUARD_TEST_TOKEN=<its token> \
 *     npx tsx scripts/schema-guard-remote-check.ts --i-confirm-this-database-is-disposable
 *
 * Expected: against a pre-Phase-27 copy -> "behind"; against a migrated copy -> "ok".
 * NEVER point this at the production or shared Preview database.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { PHASE27_PROBES, checkSchema } from "../src/lib/schemaGuard.js";

const url = process.env.TURSO_GUARD_TEST_URL?.trim();
const token = process.env.TURSO_GUARD_TEST_TOKEN?.trim();
if (!process.argv.includes("--i-confirm-this-database-is-disposable") || !url || !token) {
  console.error("Refusing to run: set TURSO_GUARD_TEST_URL and TURSO_GUARD_TEST_TOKEN for a DISPOSABLE database and pass --i-confirm-this-database-is-disposable.");
  process.exit(2);
}
if (url === process.env.TURSO_DATABASE_URL?.trim()) {
  console.error("Refusing to run: that is the same database as TURSO_DATABASE_URL.");
  process.exit(2);
}

const redact = (s: string) => s.replaceAll(token, "<token>").replace(/libsql:\/\/[^\s'"`]+/g, "<libsql-url>").replace(/https?:\/\/[^\s'"`]+/g, "<url>").slice(0, 400);
const db = new PrismaClient({ adapter: new PrismaLibSQL(createClient({ url, authToken: token })) });
try {
  console.log("verdict:", await checkSchema(db));
  // Show the real wording of each probe's failure (if any) so it can be compared with the guard's expectation.
  for (const sql of PHASE27_PROBES) {
    try {
      await db.$queryRawUnsafe(sql);
      console.log("probe ok     :", sql.slice(0, 60));
    } catch (e) {
      console.log("probe failed :", sql.slice(0, 60), "=>", redact(String((e as Error)?.message ?? e)).replace(/\s+/g, " "));
    }
  }
} finally {
  await db.$disconnect();
}

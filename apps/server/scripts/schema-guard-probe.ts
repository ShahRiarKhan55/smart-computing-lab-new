/**
 * Child process used by schema-compat-regression.mjs: runs the REAL guard probe (lib/schemaGuard.ts) against a disposable
 * SQLite file through one of the project's two database engines and prints the verdict plus the guard's HTTP-facing text.
 *   tsx scripts/schema-guard-probe.ts <db-file> plain|libsql
 * `libsql` uses @prisma/adapter-libsql exactly as production does, but against a LOCAL file URL with a dummy token.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { checkSchema } from "../src/lib/schemaGuard.js";

const [file, engine] = process.argv.slice(2);
let db: PrismaClient;
try {
  db = engine === "libsql" ? new PrismaClient({ adapter: new PrismaLibSQL(createClient({ url: `file:${file}`, authToken: "local-test-token" })) }) : new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
} catch (e) {
  // The libSQL client refuses an unopenable path at construction time (the app would fail at startup, long before the guard runs).
  console.log(JSON.stringify({ status: "engine-unavailable", name: (e as Error)?.name }));
  process.exit(0);
}
const started = Date.now();
checkSchema(db)
  .then((status) => console.log(JSON.stringify({ status, ms: Date.now() - started })))
  .catch((e) => console.log(JSON.stringify({ status: "threw", name: (e as Error)?.name })))
  .finally(() => db.$disconnect());

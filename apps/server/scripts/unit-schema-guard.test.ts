/**
 * Unit checks for the Phase 27 deploy-order guard (lib/schemaGuard.ts). Pure: no server, no database.
 *
 *   npm run test:unit -w apps/server
 */
import { PHASE27_PROBES, checkSchema, requireCurrentSchema } from "../src/lib/schemaGuard.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

const dbThatFailsWith = (message: string) => ({ $queryRawUnsafe: async () => { throw new Error(message); } }) as never;
const healthyDb = { $queryRawUnsafe: async () => [] } as never;

function res() {
  const r = { code: 0, body: null as unknown, status(c: number) { r.code = c; return r; }, json(b: unknown) { r.body = b; return r; } };
  return r;
}

async function main() {
  t("probes are static SQL strings that only SELECT", PHASE27_PROBES.every((p) => /^SELECT [^;]+ LIMIT 1$/.test(p)));
  t("probes cover every Phase 27 column and table", ["scholarUrl", "researchGateUrl", "orcid", "isPublished", "OAuthIdentity", "PublicationCandidate", "PublicationCandidateResearcher", "SyncState"].every((n) => PHASE27_PROBES.some((p) => p.includes(n))));
  t("a healthy database is ok", (await checkSchema(healthyDb)) === "ok");
  t("'no such column' means behind", (await checkSchema(dbThatFailsWith("Raw query failed. Code: `1`. Message: `no such column: scholarUrl`"))) === "behind");
  t("'no such table' means behind", (await checkSchema(dbThatFailsWith("no such table: main.OAuthIdentity"))) === "behind");
  t("any other failure (database down) is unknown, never 'behind'", (await checkSchema(dbThatFailsWith("connection refused"))) === "unknown");

  let calls = 0;
  const counting = async () => (calls++, "behind" as const);
  const guard = requireCurrentSchema(healthyDb, counting);
  const r1 = res();
  let nexted = false;
  await guard({ path: "/team" } as never, r1 as never, () => { nexted = true; });
  t("behind: a request gets 503 DB_SCHEMA_BEHIND and never reaches the route", r1.code === 503 && (r1.body as { code: string }).code === "DB_SCHEMA_BEHIND" && !nexted);
  t("behind: the message carries no SQL, column or secret", !/scholarUrl|SELECT|token|password/i.test(JSON.stringify(r1.body)));
  const r2 = res();
  await guard({ path: "/team" } as never, r2 as never, () => { nexted = true; });
  t("behind: the verdict is cached briefly (no probe on every request)", calls === 1 && r2.code === 503);
  const r3 = res();
  let healthNext = false;
  await guard({ path: "/health" } as never, r3 as never, () => { healthNext = true; });
  t("the health endpoint is never blocked", healthNext && r3.code === 0);

  let okCalls = 0;
  const okGuard = requireCurrentSchema(healthyDb, async () => (okCalls++, "ok" as const));
  let n = 0;
  for (let i = 0; i < 5; i++) await okGuard({ path: "/team" } as never, res() as never, () => { n++; });
  t("ok: requests pass and the positive result is cached for the instance", n === 5 && okCalls === 1);

  let unkNext = 0;
  const unkGuard = requireCurrentSchema(healthyDb, async () => "unknown" as const);
  await unkGuard({ path: "/team" } as never, res() as never, () => { unkNext++; });
  t("unknown: requests proceed exactly as before the guard existed (fail-open)", unkNext === 1);

  console.log(`${ok} schema-guard unit checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}
main();

/**
 * OWNER-RUN, READ-ONLY check of the DB_SCHEMA_BEHIND guard against a REAL remote Turso database that is DISPOSABLE.
 * It sends only the guard's fixed, static SELECT probes (no writes, no DDL, no arbitrary SQL) and prints a verdict plus the
 * redacted error text, so the real server wording can be compared with what the guard expects. It never uses
 * TURSO_DATABASE_URL / TURSO_AUTH_TOKEN as credentials (TURSO_DATABASE_URL is only compared, in memory, to refuse a match).
 *
 * The only databases it will talk to are the two disposable ones, identified by their EXACT full hostnames (no prefix,
 * substring or database-name matching). The hostnames are NOT in the code: the owner copies each one from the Turso dashboard
 * and sets them as environment settings. Until both are set and valid the script refuses to run (fails closed):
 *
 *   TURSO_GUARD_ALLOWED_HOST_PRE27     exact hostname of the disposable database `scl-guard-pre27`     (placeholder: unset)
 *   TURSO_GUARD_ALLOWED_HOST_P27PROV   exact hostname of the disposable database `scl-guard-p27prov`   (placeholder: unset)
 *   TURSO_GUARD_TEST_URL               libsql://<one of the two hostnames above>   (secure libsql:// scheme only)
 *   TURSO_GUARD_TEST_TOKEN             a DATABASE-SCOPED, READ-ONLY token with a SHORT expiry for that one database
 *
 *   npx tsx scripts/schema-guard-remote-check.ts --i-confirm-this-database-is-disposable
 *
 * Token scope is NOT verified by this script (it cannot be, programmatically): the owner must create the token as
 * database-scoped, read-only and short-lived (e.g. `turso db tokens create <db> --read-only --expiration <short>`), never a
 * platform/account token. Expected: against scl-guard-pre27 -> "behind"; against scl-guard-p27prov -> "ok".
 * NEVER point this at the production or shared Preview database.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE27_PROBES, checkSchema } from "../src/lib/schemaGuard.js";

export const CONFIRM_FLAG = "--i-confirm-this-database-is-disposable";
export const ENV_ALLOWED_PRE27 = "TURSO_GUARD_ALLOWED_HOST_PRE27";
export const ENV_ALLOWED_P27PROV = "TURSO_GUARD_ALLOWED_HOST_P27PROV";
export const ENV_TEST_URL = "TURSO_GUARD_TEST_URL";
export const ENV_TEST_TOKEN = "TURSO_GUARD_TEST_TOKEN";

export type Env = Record<string, string | undefined>;
type Parsed = { ok: true; host: string } | { ok: false };

/** A Turso hostname: lowercase DNS labels ending in `.turso.io`. Nothing else is ever accepted. */
const TURSO_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.turso\.io$/;

/** Lowercase, drop one trailing root dot. Does not validate. */
const normaliseHost = (h: string) => h.trim().toLowerCase().replace(/\.$/, "");

/** Strict parse of the test target: `libsql://<host>` only (no credentials, port, path, query or fragment). */
export function parseTestUrl(raw: string): Parsed {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false };
  }
  if (u.protocol !== "libsql:") return { ok: false };
  if (u.username || u.password || u.port || u.search || u.hash || (u.pathname !== "" && u.pathname !== "/")) return { ok: false };
  const host = normaliseHost(u.hostname);
  return TURSO_HOST.test(host) ? { ok: true, host } : { ok: false };
}

/** A configured allow-list entry: a bare hostname (no scheme/port/path), exact, never a pattern. */
export function parseAllowedHost(raw: string | undefined): Parsed {
  const host = normaliseHost(raw ?? "");
  return host && TURSO_HOST.test(host) ? { ok: true, host } : { ok: false };
}

/** Host of the production URL for comparison only; any scheme. Never printed. */
function parseComparisonHost(raw: string): Parsed {
  try {
    const host = normaliseHost(new URL(raw.trim()).hostname);
    return host ? { ok: true, host } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export type Config =
  | { ok: true; url: string; token: string; host: string; target: "scl-guard-pre27" | "scl-guard-p27prov" }
  | { ok: false; message: string };

const refuse = (message: string): Config => ({ ok: false, message: `Refusing to run: ${message}` });

/** All pre-flight checks, in a fixed order, with messages that never contain any input value. */
export function evaluateConfig(env: Env, argv: readonly string[]): Config {
  const rawUrl = env[ENV_TEST_URL]?.trim();
  const token = env[ENV_TEST_TOKEN]?.trim();
  if (!argv.includes(CONFIRM_FLAG) || !rawUrl || !token) {
    return refuse(`set ${ENV_TEST_URL} and ${ENV_TEST_TOKEN} for a DISPOSABLE database and pass ${CONFIRM_FLAG}.`);
  }
  const target = parseTestUrl(rawUrl);
  if (!target.ok) return refuse(`${ENV_TEST_URL} must be a plain libsql://<hostname>.turso.io URL (no credentials, port, path or query).`);

  const pre27 = parseAllowedHost(env[ENV_ALLOWED_PRE27]);
  const prov = parseAllowedHost(env[ENV_ALLOWED_P27PROV]);
  if (!pre27.ok || !prov.ok) {
    return refuse(`the host allow-list is not configured: set ${ENV_ALLOWED_PRE27} and ${ENV_ALLOWED_P27PROV} to the two exact, verified hostnames.`);
  }
  if (pre27.host === prov.host) return refuse("the two allow-list entries must be different hostnames.");

  const prodRaw = env.TURSO_DATABASE_URL?.trim();
  if (prodRaw) {
    const prod = parseComparisonHost(prodRaw);
    if (!prod.ok) return refuse("the production configuration is present but cannot be compared safely.");
    if (prod.host === pre27.host || prod.host === prov.host) return refuse("an allow-list entry matches the production database.");
    if (prod.host === target.host) return refuse("that is the production database.");
  }

  if (target.host === pre27.host) return { ok: true, url: `libsql://${target.host}`, token, host: target.host, target: "scl-guard-pre27" };
  if (target.host === prov.host) return { ok: true, url: `libsql://${target.host}`, token, host: target.host, target: "scl-guard-p27prov" };
  return refuse(`${ENV_TEST_URL} is not one of the two allow-listed disposable databases.`);
}

/** Builds a redactor that removes the token (raw and encoded), any hosts given, URLs, `*.turso.io` hosts, JWTs and stack frames. */
export function createRedactor(secrets: readonly string[]): (s: string) => string {
  const needles = new Set<string>();
  for (const s of secrets) {
    if (!s) continue;
    const enc = encodeURIComponent(s);
    for (const v of [s, enc, encodeURI(s), enc.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()), encodeURIComponent(enc), escape(s)]) if (v) needles.add(v);
  }
  const ordered = [...needles].sort((a, b) => b.length - a.length); // longest first so a short needle cannot leave a tail
  return (input: string) => {
    let out = String(input);
    for (const n of ordered) out = out.split(n).join("<redacted>");
    return out
      .replace(/^\s*at\s.*$/gim, "") // stack frames
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>]+/gi, "<url>")
      .replace(/\b[a-z0-9][a-z0-9.-]*\.turso\.io\b/gi, "<host>")
      .replace(/\beyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+){0,2}/g, "<token>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
  };
}

export type Db = { db: Parameters<typeof checkSchema>[0]; close: () => Promise<void> };
export type Deps = {
  env: Env;
  argv: readonly string[];
  makeDb: (url: string, token: string) => Promise<Db> | Db;
  out: (line: string) => void;
  err: (line: string) => void;
};

/** Returns the process exit code: 0 ran, 1 runtime failure, 2 refused. */
export async function run(deps: Deps): Promise<number> {
  const cfg = evaluateConfig(deps.env, deps.argv);
  if (!cfg.ok) {
    deps.err(cfg.message);
    return 2;
  }
  const redact = createRedactor([cfg.token, cfg.url, cfg.host, deps.env[ENV_TEST_URL] ?? "", deps.env[ENV_ALLOWED_PRE27] ?? "", deps.env[ENV_ALLOWED_P27PROV] ?? ""]);
  let handle: Db | undefined;
  try {
    handle = await deps.makeDb(cfg.url, cfg.token);
  } catch (e) {
    deps.err(`Failed to construct the database client: ${redact(String((e as Error)?.message ?? e))}`);
    return 1;
  }
  let code = 0;
  try {
    deps.out(`target : ${cfg.target}`);
    deps.out(`verdict: ${await checkSchema(handle.db)}`);
    // Show the real wording of each probe's failure (if any) so it can be compared with the guard's expectation.
    for (const sql of PHASE27_PROBES) {
      if (!/^SELECT\s/.test(sql) || /;/.test(sql)) throw new Error("refusing a non-SELECT probe");
      try {
        await handle.db.$queryRawUnsafe(sql);
        deps.out(`probe ok     : ${sql.slice(0, 60)}`);
      } catch (e) {
        deps.out(`probe failed : ${sql.slice(0, 60)} => ${redact(String((e as Error)?.message ?? e))}`);
      }
    }
  } catch (e) {
    deps.err(`Check aborted: ${redact(String((e as Error)?.message ?? e))}`);
    code = 1;
  }
  try {
    await handle.close();
  } catch (e) {
    deps.err(`Failed to close the client: ${redact(String((e as Error)?.message ?? e))}`);
    code = code || 1;
  }
  return code;
}

async function makeRealDb(url: string, authToken: string): Promise<Db> {
  const [{ PrismaClient }, { PrismaLibSQL }, { createClient }] = await Promise.all([
    import("@prisma/client"),
    import("@prisma/adapter-libsql"),
    import("@libsql/client"),
  ]);
  const db = new PrismaClient({ adapter: new PrismaLibSQL(createClient({ url, authToken })) });
  return { db, close: () => db.$disconnect() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run({
    env: process.env,
    argv: process.argv,
    makeDb: makeRealDb,
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  });
}

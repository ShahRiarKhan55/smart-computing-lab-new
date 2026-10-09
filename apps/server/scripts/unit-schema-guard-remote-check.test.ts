/**
 * OFFLINE tests for scripts/schema-guard-remote-check.ts (allow-list, URL validation, redaction, error handling, fixed probes).
 * Everything is injected: synthetic fake hostnames/tokens only, a fake in-memory db, no network, no real TURSO_* values read.
 * What this CANNOT prove: real Turso error wording, the libsql:// WebSocket path, or the scope of a real token.
 *
 *   env -u TURSO_DATABASE_URL -u TURSO_AUTH_TOKEN npx tsx scripts/unit-schema-guard-remote-check.test.ts
 */
import { PHASE27_PROBES } from "../src/lib/schemaGuard.js";
import {
  CONFIRM_FLAG, ENV_ALLOWED_P27PROV, ENV_ALLOWED_PRE27, ENV_TEST_TOKEN, ENV_TEST_URL,
  createRedactor, evaluateConfig, parseAllowedHost, parseTestUrl, run, type Db, type Env,
} from "./schema-guard-remote-check.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

// Synthetic values only.
const H_PRE = "fake-pre-org.turso.io";
const H_PROV = "fake-prov-org.turso.io";
const H_PROD = "fake-prod-org.turso.io";
const TOKEN = "eyJfakeheader.fake+payload/with=chars.fakesig";
const base: Env = { [ENV_TEST_URL]: `libsql://${H_PRE}`, [ENV_TEST_TOKEN]: TOKEN, [ENV_ALLOWED_PRE27]: H_PRE, [ENV_ALLOWED_P27PROV]: H_PROV };
const argv = ["node", "x", CONFIRM_FLAG];
const cfg = (env: Env, a: readonly string[] = argv) => evaluateConfig({ ...base, ...env }, a);
const refused = (env: Env, a?: readonly string[]) => !cfg(env, a).ok;

// 1. missing variables / flag
t("flag missing", refused({}, ["node", "x"]));
t("url missing", refused({ [ENV_TEST_URL]: undefined }));
t("token missing", refused({ [ENV_TEST_TOKEN]: undefined }));
t("token blank", refused({ [ENV_TEST_TOKEN]: "   " }));
t("happy path", cfg({}).ok);

// 2./3. malformed URLs and unsupported schemes
for (const bad of ["not a url", "libsql://", "libsql:///x", "libsql://" + H_PRE + ":8080", "libsql://u:p@" + H_PRE, "libsql://" + H_PRE + "/path",
  `libsql://${H_PRE}?x=1`, `libsql://${H_PRE}#f`, "libsql://evil.example.com", "libsql://turso.io", "libsql://*.turso.io", "libsql://a_b.turso.io"]) {
  t(`reject url ${bad.length}`, !parseTestUrl(bad).ok, bad);
}
for (const bad of [`https://${H_PRE}`, `http://${H_PRE}`, `wss://${H_PRE}`, `ws://${H_PRE}`, `file:/tmp/x.db`, `libsql+http://${H_PRE}`, H_PRE]) {
  t(`reject scheme ${bad.split(":")[0]}`, !parseTestUrl(bad).ok, bad);
}
t("normalises case and trailing dot", parseTestUrl(`libsql://${H_PRE.toUpperCase()}.`).ok && (parseTestUrl(`LIBSQL://${H_PRE.toUpperCase()}.`) as { host: string }).host === H_PRE);

// 4. exact allow-list
t("pre27 accepted", (cfg({}) as { target?: string }).target === "scl-guard-pre27");
t("prov accepted", (cfg({ [ENV_TEST_URL]: `libsql://${H_PROV}` }) as { target?: string }).target === "scl-guard-p27prov");
t("case-insensitive exact", cfg({ [ENV_TEST_URL]: `libsql://${H_PRE.toUpperCase()}` }).ok);
t("other turso host rejected", refused({ [ENV_TEST_URL]: "libsql://fake-other-org.turso.io" }));
t("prefix rejected", refused({ [ENV_TEST_URL]: `libsql://${H_PRE.replace(".turso.io", "-x.turso.io")}` }));
t("suffix/subdomain rejected", refused({ [ENV_TEST_URL]: `libsql://x.${H_PRE}` }));
t("db-name-containing host rejected", refused({ [ENV_TEST_URL]: "libsql://scl-guard-pre27-someorg.turso.io" }));
t("fail closed: both unset", refused({ [ENV_ALLOWED_PRE27]: undefined, [ENV_ALLOWED_P27PROV]: undefined }));
t("fail closed: one unset", refused({ [ENV_ALLOWED_P27PROV]: undefined }));
t("fail closed: invalid entry", refused({ [ENV_ALLOWED_PRE27]: "*.turso.io" }));
t("fail closed: URL as entry", refused({ [ENV_ALLOWED_PRE27]: `libsql://${H_PRE}` }));
t("fail closed: identical entries", refused({ [ENV_ALLOWED_P27PROV]: H_PRE }));
t("parseAllowedHost bare only", parseAllowedHost(H_PRE).ok && !parseAllowedHost(undefined).ok && !parseAllowedHost("turso.io").ok);

// 5. production rejection, no sensitive output
const prodMsgs: string[] = [];
for (const prodUrl of [`libsql://${H_PRE}`, `libsql://${H_PRE.toUpperCase()}`, `https://${H_PRE}`, `libsql://${H_PRE}?authToken=x`]) {
  const r = cfg({ TURSO_DATABASE_URL: prodUrl });
  t("prod == target rejected", !r.ok);
  if (!r.ok) prodMsgs.push(r.message);
}
const r2 = cfg({ TURSO_DATABASE_URL: `libsql://${H_PROV}` });
t("prod == allow-list entry rejected", !r2.ok);
if (!r2.ok) prodMsgs.push(r2.message);
const r3 = cfg({ TURSO_DATABASE_URL: "%%%not a url" });
t("unparseable prod fails closed", !r3.ok);
if (!r3.ok) prodMsgs.push(r3.message);
t("different prod allowed", cfg({ TURSO_DATABASE_URL: `libsql://${H_PROD}` }).ok);
const allRefusals = [...prodMsgs, ...[{ [ENV_TEST_URL]: "libsql://evil.example.com" }, { [ENV_TEST_URL]: `libsql://u:${TOKEN}@${H_PRE}` }, { [ENV_ALLOWED_PRE27]: "bad" }]
  .map((e) => cfg({ ...e, TURSO_DATABASE_URL: `libsql://${H_PROD}` })).map((c) => (c.ok ? "" : c.message))];
t("refusals never echo input", allRefusals.every((m) => !m.includes(H_PRE) && !m.includes(H_PROV) && !m.includes(H_PROD) && !m.includes(TOKEN) && !/evil\.example|fake-/.test(m)), allRefusals.join("|"));

// 6./7. redaction
const redact = createRedactor([TOKEN, `libsql://${H_PRE}`, H_PRE]);
const leak = (s: string) => s.includes(TOKEN) || s.includes(encodeURIComponent(TOKEN)) || /turso\.io|fakesig|fake\+payload|fake%2Bpayload/i.test(s);
for (const [name, input] of Object.entries({
  raw: `bad auth ${TOKEN} end`,
  encoded: `Authorization failed for ${encodeURIComponent(TOKEN)}`,
  lowerHexEncoded: `x ${encodeURIComponent(TOKEN).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())}`,
  doubleEncoded: `x ${encodeURIComponent(encodeURIComponent(TOKEN))}`,
  inUrl: `connect failed wss://${H_PRE}/?jwt=${encodeURIComponent(TOKEN)} (refused)`,
  libsqlUrl: `invalid url 'libsql://${H_PRE}'`,
  bareHost: `getaddrinfo ENOTFOUND ${H_PRE}`,
  otherBareHost: "getaddrinfo ENOTFOUND some-other-thing.turso.io:443",
  upperHost: `lookup ${H_PRE.toUpperCase()} failed`,
  unknownJwt: "token eyJhbGciOiJFZERTQSJ9.eyJhIjoicm8ifQ.c2ln rejected",
  httpUrl: "POST https://example.invalid/v2/pipeline failed",
})) {
  const out = redact(input);
  t(`redact ${name}`, !leak(out) && !out.includes("eyJhbGci") && !out.includes(H_PRE.toUpperCase()), out);
}
t("redact keeps useful wording", redact("SQLITE_ERROR: no such table: TeamMember").includes("no such table: TeamMember"));
t("redact strips stack frames", !/\bat\b.*\(/.test(redact("boom\n    at foo (/home/x/file.js:1:2)\n    at bar (/x.js:3:4)")));
t("redact truncates", redact("a".repeat(5000)).length <= 400);

// 8./9. execution: fake db, client-construction errors, query errors, fixed SELECTs only
type Fake = { sql: string[]; closed: number };
const makeFake = (impl: (sql: string) => Promise<unknown>): { make: () => Db; f: Fake } => {
  const f: Fake = { sql: [], closed: 0 };
  return { f, make: () => ({ db: { $queryRawUnsafe: (async (sql: string) => { f.sql.push(sql); return impl(sql); }) as unknown as Db["db"]["$queryRawUnsafe"] }, close: async () => { f.closed++; } }) };
};
const exec = async (env: Env, make: (u: string, tk: string) => Promise<Db> | Db) => {
  const lines: string[] = [], errs: string[] = [];
  const code = await run({ env: { ...base, ...env }, argv, makeDb: make, out: (l) => lines.push(l), err: (l) => errs.push(l) });
  return { code, text: [...lines, ...errs].join("\n"), lines, errs };
};

{ // all ok
  const { make, f } = makeFake(async () => []);
  const r = await exec({}, make);
  t("ok run exit 0", r.code === 0);
  t("ok verdict", r.lines.includes("verdict: ok"));
  t("probes: only fixed SELECTs", f.sql.length === PHASE27_PROBES.length * 2 && f.sql.every((s) => (PHASE27_PROBES as readonly string[]).includes(s) && /^SELECT\s/.test(s) && !/;|\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/i.test(s)));
  t("client closed", f.closed === 1);
}
{ // behind, message carrying secrets
  const { make } = makeFake(async () => { throw new Error(`SQLITE_ERROR: no such column: TeamMember.scholarUrl at wss://${H_PRE}/?t=${encodeURIComponent(TOKEN)} ${TOKEN}`); });
  const r = await exec({}, make);
  t("behind verdict", r.lines.includes("verdict: behind"));
  t("probe errors redacted", !leak(r.text), r.text);
  t("wording preserved", r.text.includes("no such column: TeamMember.scholarUrl"));
}
{ // unknown
  const { make } = makeFake(async () => { throw new Error("connection reset"); });
  const r = await exec({}, make);
  t("unknown verdict", r.lines.includes("verdict: unknown"));
}
{ // client construction error with secrets + stack
  const e = new Error(`The URL 'libsql://${H_PRE}' is not valid; token ${TOKEN}; ${encodeURIComponent(TOKEN)}`);
  e.stack = `Error: leaked\n    at secretFunction (/home/user/secret/path.js:1:1)`;
  const r = await exec({}, () => { throw e; });
  t("construct error exit 1", r.code === 1);
  t("construct error redacted", !leak(r.text) && !r.text.includes("secretFunction") && !r.text.includes("/home/user"), r.text);
  const r2 = await exec({}, async () => { throw e; });
  t("async construct error handled", r2.code === 1 && !leak(r2.text));
}
{ // non-Error throw and close failure
  const r = await exec({}, () => { throw TOKEN; });
  t("non-Error throw redacted", r.code === 1 && !leak(r.text));
  const f = { sql: 0 };
  const r2 = await exec({}, () => ({ db: { $queryRawUnsafe: (async () => { f.sql++; return []; }) as unknown as Db["db"]["$queryRawUnsafe"] }, close: async () => { throw new Error(`close ${TOKEN}`); } }));
  t("close failure handled+redacted", r2.code === 1 && !leak(r2.text));
}
{ // refused config never builds a client
  let built = 0;
  const r = await exec({ [ENV_TEST_URL]: "libsql://evil.example.com" }, () => { built++; return { db: { $queryRawUnsafe: (async () => []) as unknown as Db["db"]["$queryRawUnsafe"] }, close: async () => {} }; });
  t("refused: exit 2, no client", r.code === 2 && built === 0);
  const r2 = await exec({ TURSO_DATABASE_URL: `libsql://${H_PRE}` }, () => { built++; throw new Error("x"); });
  t("prod match: no client", r2.code === 2 && built === 0 && !leak(r2.text));
}
{ // client receives the normalised URL and the token only
  let seen: [string, string] | undefined;
  await exec({ [ENV_TEST_URL]: `LIBSQL://${H_PRE.toUpperCase()}.` }, (u, tk) => { seen = [u, tk]; return { db: { $queryRawUnsafe: (async () => []) as unknown as Db["db"]["$queryRawUnsafe"] }, close: async () => {} }; });
  t("normalised url passed", seen?.[0] === `libsql://${H_PRE}` && seen?.[1] === TOKEN);
}

console.log(`schema-guard-remote-check offline tests: ${ok} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("FAIL:", f); process.exit(1); }

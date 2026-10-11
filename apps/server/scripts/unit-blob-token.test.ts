/**
 * Unit test of Blob token selection in lib/storage.ts: the Private store's `LAB_BLOB_READ_WRITE_TOKEN`
 * is preferred, `BLOB_READ_WRITE_TOKEN` is only a fallback, and the SELECTED token is passed explicitly
 * to all four Vercel Blob SDK operations (put / get / head / del) — an explicit token outranks the
 * SDK's OIDC / BLOB_STORE_ID / default-env lookup, so a project that also holds the old Public store's
 * token can never reach the wrong store.
 *
 * Fully offline: the SDK's HTTP layer (undici) is replaced by undici's MockAgent with network access
 * disabled, and every token below is a made-up string (no real credential, no real store). The
 * token-dependent module state is fixed at import, so each scenario runs in a child process.
 *   npm run test:unit -w apps/server
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAB = "vercel_blob_rw_labstore0001_fakeLABsecret";
const PUB = "vercel_blob_rw_pubstore0002_fakePUBsecret";
const HERE = fileURLToPath(import.meta.url);
// Same launcher the other unit tests use for tsx child processes (cross-platform: no `--import <abs path>`).
const REPO_ROOT = path.resolve(path.dirname(HERE), "..", "..", "..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// ======================================================================================
// CHILD MODE: run one scenario, print `RESULT:<json>` and exit.
// ======================================================================================
const mode = process.argv[2];
if (mode) {
  const { MockAgent, setGlobalDispatcher } = await import("undici");
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);

  const requests: { host: string; method: string; auth: string | null; access: string | null; storeId: string | null }[] = [];
  const failPut = mode === "put-error";
  for (const origin of ["https://vercel.com", "https://labstore0001.private.blob.vercel-storage.com", "https://pubstore0002.private.blob.vercel-storage.com"]) {
    agent
      .get(origin)
      .intercept({ path: () => true, method: () => true })
      .reply((o) => {
        const h = (o.headers ?? {}) as Record<string, string>;
        requests.push({
          host: origin.replace("https://", ""),
          method: String(o.method),
          auth: h.authorization ?? null,
          access: h["x-vercel-blob-access"] ?? null,
          storeId: h["x-vercel-blob-store-id"] ?? null,
        });
        if (failPut && o.method === "PUT") {
          return { statusCode: 403, data: JSON.stringify({ error: { code: "forbidden", message: "Cannot use private access on a public store." } }), responseOptions: { headers: { "content-type": "application/json" } } };
        }
        if (origin.includes(".private.blob.")) {
          // the blob host serves the object's bytes (what `get()` streams back)
          return { statusCode: 200, data: "abc", responseOptions: { headers: { "content-type": "image/png", etag: "e", "content-length": "3" } } };
        }
        const url = "https://labstore0001.private.blob.vercel-storage.com/k";
        return {
          statusCode: 200,
          data: JSON.stringify({ url, downloadUrl: url, pathname: "k", contentType: "image/png", contentDisposition: "inline", cacheControl: "x", size: 3, uploadedAt: new Date().toISOString(), etag: "e" }),
          responseOptions: { headers: { "content-type": "image/png", etag: "e", "content-length": "3" } },
        };
      })
      .persist();
  }

  for (const k of ["VERCEL_OIDC_TOKEN", "BLOB_STORE_ID", "LAB_BLOB_READ_WRITE_TOKEN", "BLOB_READ_WRITE_TOKEN"]) delete process.env[k];
  if (mode === "lab" || mode === "put-error") { process.env.LAB_BLOB_READ_WRITE_TOKEN = LAB; process.env.BLOB_READ_WRITE_TOKEN = PUB; }
  else if (mode === "fallback") process.env.BLOB_READ_WRITE_TOKEN = PUB;
  else if (mode === "blank-lab") { process.env.LAB_BLOB_READ_WRITE_TOKEN = "   "; process.env.BLOB_READ_WRITE_TOKEN = PUB; }
  else if (mode === "lab-trim") { process.env.LAB_BLOB_READ_WRITE_TOKEN = `  ${LAB}\t\n`; process.env.BLOB_READ_WRITE_TOKEN = PUB; }
  else if (mode === "none") { process.env.NODE_ENV = "production"; process.env.VERCEL = "1"; }

  const logged: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(" "));
  const { saveFile, fileExists, openReadStream, removeFile } = await import("../src/lib/storage.js");
  const out: Record<string, unknown> = { mode };
  try {
    const key = await saveFile(Buffer.from("abc"));
    out.saved = /^[0-9a-f-]{36}$/.test(key);
    out.exists = await fileExists(key);
    const stream = await openReadStream(key);
    let bytes = 0;
    for await (const chunk of stream) bytes += (chunk as Buffer).length;
    out.readBytes = bytes;
    await removeFile(key);
  } catch (err) {
    out.error = `${(err as Error).name}: ${(err as Error).message}`;
  }
  console.error = origErr;
  out.requests = requests;
  out.logged = logged;
  console.log(`RESULT:${JSON.stringify(out)}`);
  process.exit(0);
}

// ======================================================================================
// PARENT MODE
// ======================================================================================
let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));
const { resolveBlobToken, isPersistentStorageUnavailable } = await import("../src/lib/storage.js");

// ---- token precedence / trimming / blanks ---------------------------------------------
t("LAB token alone is selected", resolveBlobToken({ LAB_BLOB_READ_WRITE_TOKEN: "lab" }) === "lab");
t("default token alone is the fallback", resolveBlobToken({ BLOB_READ_WRITE_TOKEN: "def" }) === "def");
t("LAB token beats the default token when both are set", resolveBlobToken({ LAB_BLOB_READ_WRITE_TOKEN: "lab", BLOB_READ_WRITE_TOKEN: "def" }) === "lab");
t("the LAB token is trimmed", resolveBlobToken({ LAB_BLOB_READ_WRITE_TOKEN: "  lab \n" }) === "lab");
t("the fallback token is trimmed", resolveBlobToken({ BLOB_READ_WRITE_TOKEN: "\tdef  " }) === "def");
t("an empty LAB value falls back to the default", resolveBlobToken({ LAB_BLOB_READ_WRITE_TOKEN: "", BLOB_READ_WRITE_TOKEN: "def" }) === "def");
t("a whitespace-only LAB value falls back to the default", resolveBlobToken({ LAB_BLOB_READ_WRITE_TOKEN: "   \t", BLOB_READ_WRITE_TOKEN: "def" }) === "def");
t("both unset -> no token", resolveBlobToken({}) === undefined);
t("both empty -> no token", resolveBlobToken({ LAB_BLOB_READ_WRITE_TOKEN: "", BLOB_READ_WRITE_TOKEN: "" }) === undefined);
t("both whitespace-only -> no token", resolveBlobToken({ LAB_BLOB_READ_WRITE_TOKEN: " ", BLOB_READ_WRITE_TOKEN: "  " }) === undefined);
t("a whitespace-only default alone -> no token", resolveBlobToken({ BLOB_READ_WRITE_TOKEN: "   " }) === undefined);
t("unrelated variables are ignored", resolveBlobToken({ BLOB_STORE_ID: "x", VERCEL_OIDC_TOKEN: "y" }) === undefined);

// ---- the availability check uses the same selection --------------------------------------
const prod = { NODE_ENV: "production", VERCEL: "1" };
t("availability: LAB token only -> available", isPersistentStorageUnavailable({ ...prod, LAB_BLOB_READ_WRITE_TOKEN: "lab" }) === false);
t("availability: default token only -> available", isPersistentStorageUnavailable({ ...prod, BLOB_READ_WRITE_TOKEN: "def" }) === false);
t("availability: both tokens -> available", isPersistentStorageUnavailable({ ...prod, LAB_BLOB_READ_WRITE_TOKEN: "lab", BLOB_READ_WRITE_TOKEN: "def" }) === false);
t("availability: blank LAB + default -> available (fallback)", isPersistentStorageUnavailable({ ...prod, LAB_BLOB_READ_WRITE_TOKEN: " ", BLOB_READ_WRITE_TOKEN: "def" }) === false);
t("availability: no token -> unavailable", isPersistentStorageUnavailable(prod) === true);
t("availability: only blank values -> unavailable", isPersistentStorageUnavailable({ ...prod, LAB_BLOB_READ_WRITE_TOKEN: " ", BLOB_READ_WRITE_TOKEN: "\t" }) === true);
t("availability: non-Vercel production is unaffected", isPersistentStorageUnavailable({ NODE_ENV: "production" }) === false);

// ---- all four SDK operations receive the selected token (offline, mocked HTTP) -------------
function runScenario(m: string): { ok: boolean; out: any; stderr: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "scl-blob-token-test-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, STORAGE_DIR: dir, NODE_ENV: "development" };
    for (const k of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL_OIDC_TOKEN", "BLOB_STORE_ID", "LAB_BLOB_READ_WRITE_TOKEN", "BLOB_READ_WRITE_TOKEN", "VERCEL"]) delete env[k];
    const r = spawnSync(process.execPath, [TSX_CLI, HERE, m], { env, encoding: "utf8", timeout: 60000 });
    const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("RESULT:"));
    return { ok: r.status === 0 && !!line, out: line ? JSON.parse(line.slice(7)) : null, stderr: r.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const bearer = (tok: string) => `Bearer ${tok}`;
const ops = (o: any) => ({
  put: o.requests.find((r: any) => r.method === "PUT"),
  head: o.requests.find((r: any) => r.method === "GET" && r.host === "vercel.com"),
  del: o.requests.find((r: any) => r.method === "POST"),
  get: o.requests.find((r: any) => r.method === "GET" && r.host.endsWith(".private.blob.vercel-storage.com")),
});

{
  const s = runScenario("lab");
  t("scenario lab: ran cleanly", s.ok && !s.out?.error);
  if (s.ok && s.out) {
    const o = ops(s.out);
    t("scenario lab: put, head, del and get were each sent exactly once (4 requests, no fallback to disk)", s.out.requests.length === 4 && !!o.put && !!o.head && !!o.del && !!o.get);
    t("scenario lab: put sends the LAB token", o.put?.auth === bearer(LAB));
    t("scenario lab: head sends the LAB token", o.head?.auth === bearer(LAB));
    t("scenario lab: get sends the LAB token", o.get?.auth === bearer(LAB));
    t("scenario lab: del sends the LAB token", o.del?.auth === bearer(LAB));
    t("scenario lab: the default (Public store) token is NEVER sent when the LAB token is set", s.out.requests.every((r: any) => r.auth !== bearer(PUB)));
    t("scenario lab: every request targets the LAB store id (derived from the token)", s.out.requests.filter((r: any) => r.storeId).every((r: any) => r.storeId === "labstore0001") && o.get?.host.startsWith("labstore0001."));
    t("scenario lab: put still requests PRIVATE access", o.put?.access === "private");
    t("scenario lab: upload, existence check, read and delete all succeeded", s.out.saved === true && s.out.exists === true && s.out.readBytes === 3);
    t("scenario lab: no log line contains either token", s.out.logged.every((l: string) => !l.includes(LAB) && !l.includes(PUB)));
  }
}
for (const [m, expectTok, label] of [["fallback", PUB, "default token is used when the LAB variable is unset"], ["blank-lab", PUB, "default token is used when the LAB variable is blank"], ["lab-trim", LAB, "a LAB token with surrounding whitespace is sent trimmed"]] as const) {
  const s = runScenario(m);
  t(`scenario ${m}: ran cleanly`, s.ok && !s.out?.error);
  if (s.ok && s.out) {
    const o = ops(s.out);
    t(`scenario ${m}: ${label} — for put, head, get and del`, [o.put, o.head, o.get, o.del].every((r) => r?.auth === bearer(expectTok)) && s.out.requests.length === 4);
  }
}
{
  const s = runScenario("none");
  t("scenario none (production on Vercel, no token): the upload is refused with the 503 error and no request is sent",
    s.ok && /StorageUnavailableError/.test(s.out?.error ?? "") && s.out.requests.length === 0);
}
{
  const s = runScenario("put-error");
  t("scenario put-error: a rejected put surfaces as an error", s.ok && typeof s.out?.error === "string");
  t("scenario put-error: neither the thrown error text nor any log line contains a token", s.ok && !String(s.out?.error).includes(LAB) && !String(s.out?.error).includes(PUB) && s.out.logged.every((l: string) => !l.includes(LAB) && !l.includes(PUB)) && !s.stderr.includes(LAB) && !s.stderr.includes(PUB));
  t("scenario put-error: only the LAB token was used for the failed put", s.ok && s.out.requests.every((r: any) => r.auth === bearer(LAB)));
}

console.log(`${ok} blob-token unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

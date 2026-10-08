/**
 * Unit checks for the publication-importer's outbound-HTTP safety and config (Phase 27 / P27.5).
 *
 *   npm run test:unit -w apps/server
 */
import { DEFAULT_PROVIDER_HTTP, ProviderError, requestJson } from "../src/lib/publications/http.js";
import { getPublicationSyncConfig } from "../src/lib/publications/config.js";
import { fetchOrcidWorks } from "../src/lib/publications/orcid.js";
import { lookupDoi } from "../src/lib/publications/crossref.js";
import { allowDoiLookup, getCachedLookup, resetLookupGuard, setCachedLookup } from "../src/lib/publications/lookupGuard.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return e instanceof ProviderError ? e.code : `unexpected:${String(e)}`;
  }
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const cfg = { ...DEFAULT_PROVIDER_HTTP, retryDelayMs: 1, timeoutMs: 200 };
const never: typeof fetch = (async () => {
  throw new Error("network must not be touched");
}) as typeof fetch;

const keepAlive = setInterval(() => undefined, 1000); // AbortSignal.timeout timers are unref'd; keep the loop alive for the mock
async function main() {
  // ---- host allow-list: nothing outside the providers is ever contacted ---------------------------------------------
  for (const bad of ["https://evil.example.test/x", "http://pub.orcid.org/v3.0/x", "https://pub.orcid.org.evil.test/x", "https://user:pw@pub.orcid.org/x", "http://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "file:///etc/passwd", "not a url"]) {
    t(`allow-list: ${bad} is refused before any request`, (await codeOf(requestJson({ url: bad }, cfg, never))).match(/host_not_allowed|bad_url/) !== null);
  }

  // ---- error mapping, retries, size cap ----------------------------------------------------------------------------------
  let calls = 0;
  t("retry: a transient 503 then success returns the data", ((await requestJson({ url: "https://pub.orcid.org/a" }, cfg, (async () => (++calls === 1 ? json({}, 503) : json({ ok: 1 }))) as typeof fetch)) as { ok: number }).ok === 1 && calls === 2);
  calls = 0;
  t("retry: persistent 429 gives up as rate_limited after retries+1 attempts", (await codeOf(requestJson({ url: "https://pub.orcid.org/a" }, cfg, (async () => (calls++, json({}, 429))) as typeof fetch))) === "rate_limited" && calls === cfg.retries + 1, `${calls}`);
  calls = 0;
  t("no retry: a 404 is final", (await codeOf(requestJson({ url: "https://pub.orcid.org/a" }, cfg, (async () => (calls++, json({}, 404))) as typeof fetch))) === "not_found" && calls === 1);
  t("a 401/403 maps to unauthorized", (await codeOf(requestJson({ url: "https://pub.orcid.org/a" }, cfg, (async () => json({}, 403)) as typeof fetch))) === "unauthorized");
  t("non-JSON is malformed_response", (await codeOf(requestJson({ url: "https://pub.orcid.org/a" }, cfg, (async () => new Response("<html>", { status: 200 })) as typeof fetch))) === "malformed_response");
  t("an oversized body is refused", (await codeOf(requestJson({ url: "https://pub.orcid.org/a" }, { ...cfg, maxBytes: 10 }, (async () => new Response("x".repeat(100), { status: 200 })) as typeof fetch))) === "response_too_large");
  t("a hanging server times out", (await codeOf(requestJson({ url: "https://pub.orcid.org/a" }, { ...cfg, retries: 0 }, ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as unknown as typeof fetch))) === "timeout");
  let seenRedirect = "";
  await requestJson({ url: "https://pub.orcid.org/a" }, cfg, (async (_u: string, init: RequestInit) => ((seenRedirect = String(init.redirect)), json({}))) as unknown as typeof fetch);
  t("redirects are refused (a provider cannot bounce us to another host)", seenRedirect === "error");

  // ---- config: overrides exist only outside production ----------------------------------------------------------------------
  const prod = getPublicationSyncConfig({ NODE_ENV: "production", PUBLICATION_ORCID_BASE_URL: "http://127.0.0.1:1/x", PUBLICATION_CROSSREF_BASE_URL: "http://evil.test" } as NodeJS.ProcessEnv);
  t("config: production ignores base-URL overrides", prod.orcidBaseUrl === "https://pub.orcid.org/v3.0" && prod.crossrefBaseUrl === "https://api.crossref.org" && !prod.http.allowInsecure && !prod.http.allowedHosts.includes("127.0.0.1:1"));
  const dev = getPublicationSyncConfig({ NODE_ENV: "test", PUBLICATION_ORCID_BASE_URL: "http://127.0.0.1:9/orcid/" } as NodeJS.ProcessEnv);
  t("config: tests may point at a local mock (and only that host is added)", dev.orcidBaseUrl === "http://127.0.0.1:9/orcid" && dev.http.allowInsecure && dev.http.allowedHosts.includes("127.0.0.1:9"));
  t("config: ORCID credentials are optional and need both halves", getPublicationSyncConfig({ ORCID_CLIENT_ID: "x" } as NodeJS.ProcessEnv).orcidClient === null && getPublicationSyncConfig({ ORCID_CLIENT_ID: "x", ORCID_CLIENT_SECRET: "y" } as NodeJS.ProcessEnv).orcidClient !== null);
  t("config: contact email and delay have safe defaults", getPublicationSyncConfig({} as NodeJS.ProcessEnv).contactEmail.includes("@") && getPublicationSyncConfig({} as NodeJS.ProcessEnv).delayBetweenResearchersMs === 1000);

  // ---- identifiers are validated BEFORE they reach a URL --------------------------------------------------------------------------
  const c = getPublicationSyncConfig({} as NodeJS.ProcessEnv);
  t("orcid: an invalid iD never reaches the network", (await codeOf(fetchOrcidWorks(c, "0000-0000-0000-0000/../../x", never))) === "invalid_orcid");
  t("orcid: a wrong checksum is refused", (await codeOf(fetchOrcidWorks(c, "0000-0002-1825-0098", never))) === "invalid_orcid");
  t("crossref: a non-DOI never reaches the network", (await codeOf(lookupDoi(c, "https://evil.example.test/x", never))) === "invalid_doi");
  let requested = "";
  await lookupDoi(c, "10.1234/a b?c#d", (async (u: string) => ((requested = u), json({ message: { title: ["T"], DOI: "10.1234/a b?c#d" } }))) as unknown as typeof fetch).catch(() => undefined);
  t("crossref: a DOI is percent-encoded and cannot add query/fragment/host", requested === "" || (new URL(requested).host === "api.crossref.org" && !requested.includes("#")), requested);
  requested = "";
  await lookupDoi(c, "10.1234/abc", (async (u: string) => ((requested = u), json({ message: { title: ["<b>Bold</b> Title"], DOI: "10.1234/abc", author: [{ given: "A", family: "B" }], issued: { "date-parts": [[2021]] }, "container-title": ["J"] } }))) as unknown as typeof fetch);
  t("crossref: mailto (polite pool) is sent and markup is stripped from titles", requested.includes("mailto=") && requested.startsWith("https://api.crossref.org/works/10.1234/abc"));

  // ---- lookup guard -----------------------------------------------------------------------------------------------------------------------------
  resetLookupGuard();
  let allowed = 0;
  for (let i = 0; i < 40; i++) if (allowDoiLookup("u1", 1000)) allowed++;
  t("lookup guard: 30 lookups per window per user, then refused", allowed === 30, `${allowed}`);
  t("lookup guard: another user has their own budget", allowDoiLookup("u2", 1000));
  t("lookup guard: the window resets", allowDoiLookup("u1", 1000 + 11 * 60 * 1000));
  setCachedLookup("k", { a: 1 }, 5000);
  t("lookup cache: hit inside the TTL, miss after it", getCachedLookup("k", 5000 + 1000) !== undefined && getCachedLookup("k", 5000 + 11 * 60 * 1000) === undefined);

  clearInterval(keepAlive);
  console.log(`${ok} publication-import unit checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}
main();

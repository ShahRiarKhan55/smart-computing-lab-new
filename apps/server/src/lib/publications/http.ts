/**
 * The ONLY outbound HTTP client the publication importer uses (Phase 27 / P27.5). Everything an
 * external service can influence is bounded here: which hosts may be contacted at all (a fixed
 * allow-list, so a DOI or ORCID iD can never steer a request to an internal address — the URL is
 * always built from a fixed host plus a validated, percent-encoded identifier), how long a request
 * may take, how often a transient failure is retried, and how large a response may be.
 */
export class ProviderError extends Error {
  /** Stable machine code, e.g. "timeout", "rate_limited", "not_found", "http_503", "malformed_response". */
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "ProviderError";
    this.code = code;
  }
}

export interface ProviderHttpConfig {
  /** Hosts requests may go to (exact match, lower-case). */
  allowedHosts: string[];
  /** Allow plain http (automated tests against a local mock only; never in production). */
  allowInsecure: boolean;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  maxBytes: number;
}

export const DEFAULT_PROVIDER_HTTP: ProviderHttpConfig = {
  allowedHosts: ["pub.orcid.org", "orcid.org", "api.crossref.org"],
  allowInsecure: false,
  timeoutMs: 10_000,
  retries: 2,
  retryDelayMs: 500,
  maxBytes: 4 * 1024 * 1024,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertAllowed(url: string, cfg: ProviderHttpConfig): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ProviderError("bad_url");
  }
  const protocolOk = u.protocol === "https:" || (cfg.allowInsecure && u.protocol === "http:");
  if (!protocolOk || u.username || u.password || !cfg.allowedHosts.includes(u.host.toLowerCase())) throw new ProviderError("host_not_allowed");
}

/** Reads a response body as text, refusing anything larger than `maxBytes` (a hostile or broken server cannot exhaust memory). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ProviderError("response_too_large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderError("response_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface JsonRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: URLSearchParams;
}

/**
 * Sends the request and returns parsed JSON. Retries only transient failures (network error, timeout,
 * 429, 5xx) up to `cfg.retries`, honouring a short `Retry-After`; 4xx answers are final. Throws
 * `ProviderError` with a stable code — never the provider's own message or body.
 */
export async function requestJson(req: JsonRequest, cfg: ProviderHttpConfig, doFetch: typeof fetch = fetch): Promise<unknown> {
  assertAllowed(req.url, cfg);
  let lastCode = "unreachable";
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    if (attempt > 0) await sleep(cfg.retryDelayMs * attempt);
    let res: Response;
    try {
      res = await doFetch(req.url, {
        method: req.method ?? "GET",
        headers: { accept: "application/json", ...req.headers },
        body: req.body,
        redirect: "error", // a provider must not be able to bounce us to a host outside the allow-list
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (err) {
      lastCode = (err as { name?: string })?.name === "TimeoutError" || (err as { name?: string })?.name === "AbortError" ? "timeout" : "unreachable";
      continue;
    }
    if (res.status === 429) {
      lastCode = "rate_limited";
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0 && attempt < cfg.retries) await sleep(Math.min(retryAfter, 5) * 1000);
      continue;
    }
    if (res.status >= 500) {
      lastCode = `http_${res.status}`;
      continue;
    }
    if (res.status === 404) throw new ProviderError("not_found");
    if (res.status === 401 || res.status === 403) throw new ProviderError("unauthorized");
    if (!res.ok) throw new ProviderError(`http_${res.status}`);
    const text = await readCapped(res, cfg.maxBytes);
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError("malformed_response");
    }
  }
  throw new ProviderError(lastCode);
}

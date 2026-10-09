import { doiKey, doiToUrl, normalizeDoi } from "@scl/shared";
import { requestJson, ProviderError } from "./http.js";
import type { PublicationSyncConfig } from "./config.js";

/** What Crossref knows about one DOI, trimmed to the fields a publication record needs. */
export interface DoiMetadata {
  doi: string;
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  url: string;
  workType: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : undefined);

/** Crossref titles sometimes carry markup (<i>, <jats:...>); keep the text only. */
const stripTags = (s: string): string => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

function authorName(a: unknown): string {
  if (!a || typeof a !== "object") return "";
  const o = a as { given?: unknown; family?: unknown; name?: unknown };
  const full = `${str(o.given)} ${str(o.family)}`.trim();
  return full || str(o.name);
}

function yearOf(msg: Record<string, unknown>): number | null {
  for (const key of ["published", "published-print", "published-online", "issued", "created"]) {
    const parts = (msg[key] as { "date-parts"?: unknown } | undefined)?.["date-parts"];
    const year = Array.isArray(parts) && Array.isArray(parts[0]) ? Number(parts[0][0]) : NaN;
    if (Number.isInteger(year) && year >= 1900 && year <= 2100) return year;
  }
  return null;
}

/**
 * Looks one DOI up in Crossref. The request URL is the fixed Crossref host plus the percent-encoded,
 * validated DOI, so the DOI can never alter the host or path structure. Throws `ProviderError`
 * ("not_found" for an unknown DOI, "malformed_response", "timeout", "rate_limited", …).
 */
export async function lookupDoi(cfg: PublicationSyncConfig, doiInput: string, doFetch: typeof fetch = fetch): Promise<DoiMetadata> {
  const doi = normalizeDoi(doiInput);
  if (!doi) throw new ProviderError("invalid_doi");
  const url = `${cfg.crossrefBaseUrl}/works/${doi.split("/").map(encodeURIComponent).join("/")}?mailto=${encodeURIComponent(cfg.contactEmail)}`;
  // Defence in depth: whatever the DOI contains, the request must stay under `<base>/works/` on the configured host.
  const parsed = new URL(url);
  const basePath = new URL(cfg.crossrefBaseUrl).pathname.replace(/\/+$/, "");
  if (parsed.host !== new URL(cfg.crossrefBaseUrl).host || !parsed.pathname.startsWith(`${basePath}/works/`)) throw new ProviderError("invalid_doi");
  const body = await requestJson({ url, headers: { "user-agent": `SmartComputingLabWebsite/1.0 (mailto:${cfg.contactEmail})` } }, cfg.http, doFetch);
  const msg = (body as { message?: unknown } | null)?.message;
  if (!msg || typeof msg !== "object") throw new ProviderError("malformed_response");
  const m = msg as Record<string, unknown>;
  const title = stripTags(str(first(m.title)));
  if (!title) throw new ProviderError("malformed_response");
  const authors = (Array.isArray(m.author) ? m.author : []).map(authorName).filter(Boolean).join(", ");
  return {
    doi: str(m.DOI) && normalizeDoi(str(m.DOI)) ? normalizeDoi(str(m.DOI))! : doi,
    title,
    authors,
    year: yearOf(m),
    venue: stripTags(str(first(m["container-title"])) || str(first(m["short-container-title"]))),
    url: doiToUrl(doi),
    workType: str(m.type),
  };
}

export { doiKey };

import { doiKey, doiToUrl, isHttpUrl, normalizeDoi, normalizeOrcid } from "@scl/shared";
import { requestJson, ProviderError } from "./http.js";
import type { PublicationSyncConfig } from "./config.js";
import type { DiscoveredWork } from "./types.js";

/**
 * ORCID Public API reader (Phase 27 / P27.5): the researcher's PUBLIC works list.
 *
 * What it can and cannot do (documented in docs/user-guide and the PR):
 * - It sees only works the person has made PUBLIC on their own ORCID record; nothing else.
 * - A work summary has no author list; authors are filled in from Crossref for works that have a DOI,
 *   and otherwise left for the editor to type at approval.
 * - It finds what ORCID holds. It does not promise every publication — a paper missing from the
 *   researcher's ORCID record cannot be discovered, and is added by hand.
 */

const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

let tokenCache: { token: string; expiresAt: number; key: string } | null = null;

/** A `/read-public` access token via the client-credentials flow, cached until shortly before it expires. Null when no credentials are configured. */
async function getAccessToken(cfg: PublicationSyncConfig, doFetch: typeof fetch): Promise<string | null> {
  if (!cfg.orcidClient) return null;
  const key = `${cfg.orcidTokenUrl}|${cfg.orcidClient.id}`;
  if (tokenCache && tokenCache.key === key && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const body = await requestJson(
    {
      url: cfg.orcidTokenUrl,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.orcidClient.id, client_secret: cfg.orcidClient.secret, grant_type: "client_credentials", scope: "/read-public" }),
    },
    { ...cfg.http, retries: 0 },
    doFetch,
  );
  const token = str(obj(body)?.access_token);
  if (!token) throw new ProviderError("malformed_response");
  const expiresIn = Number(obj(body)?.expires_in);
  tokenCache = { token, key, expiresAt: Date.now() + Math.min(Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000, 12 * 3600_000) - 60_000 };
  return token;
}

export function clearOrcidTokenCache(): void {
  tokenCache = null;
}

function pickDoi(externalIds: unknown): string {
  const list = obj(externalIds)?.["external-id"];
  if (!Array.isArray(list)) return "";
  for (const raw of list) {
    const e = obj(raw);
    if (!e || str(e["external-id-type"]).toLowerCase() !== "doi") continue;
    // Prefer ORCID's own normalised form, fall back to the value as the researcher/source entered it.
    const doi = normalizeDoi(str(obj(e["external-id-normalized"])?.value)) ?? normalizeDoi(str(e["external-id-value"]));
    if (doi) return doi;
  }
  return "";
}

function parseWorkSummary(orcid: string, group: Record<string, unknown>): DiscoveredWork | null {
  const summaries = group["work-summary"];
  if (!Array.isArray(summaries) || summaries.length === 0) return null;
  // ORCID orders a group's summaries by preference; the first is the one the researcher prefers.
  const w = obj(summaries[0]);
  if (!w) return null;

  const title = str(obj(obj(w.title)?.title)?.value);
  const year = Number(str(obj(obj(w["publication-date"])?.year)?.value));
  if (!title || !Number.isInteger(year) || year < 1900 || year > 2100) return null; // no title / no usable year -> not importable

  const doi = pickDoi(w["external-ids"]) || pickDoi(group["external-ids"]);
  const putCode = String(w["put-code"] ?? "");
  const sourceUrl = str(obj(w.url)?.value);
  return {
    provider: "ORCID",
    externalId: doi ? `doi:${doiKey(doi)}` : `orcid:${orcid}:${/^\d{1,20}$/.test(putCode) ? putCode : title.toLowerCase().slice(0, 60)}`,
    doi: doi ? doiKey(doi)! : "",
    title: title.slice(0, 500),
    authors: "",
    year,
    venue: str(obj(w["journal-title"])?.value).slice(0, 500),
    url: doi ? doiToUrl(doi) : isHttpUrl(sourceUrl) ? sourceUrl : "",
    workType: str(w.type).slice(0, 60),
  };
}

/**
 * The public works of one researcher. `orcidInput` must be a valid iD (the caller already validated it, but
 * it is re-checked here because the value goes into a URL). Throws `ProviderError`; the sync records the
 * code against that researcher and carries on with the next.
 */
export async function fetchOrcidWorks(cfg: PublicationSyncConfig, orcidInput: string, doFetch: typeof fetch = fetch): Promise<DiscoveredWork[]> {
  const orcid = normalizeOrcid(orcidInput);
  if (!orcid) throw new ProviderError("invalid_orcid");

  const token = await getAccessToken(cfg, doFetch);
  const body = await requestJson(
    {
      url: `${cfg.orcidBaseUrl}/${orcid}/works`,
      headers: { "user-agent": `SmartComputingLabWebsite/1.0 (mailto:${cfg.contactEmail})`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    },
    cfg.http,
    doFetch,
  );
  const groups = obj(body)?.group;
  if (!Array.isArray(groups)) throw new ProviderError("malformed_response");

  const works: DiscoveredWork[] = [];
  for (const g of groups) {
    const group = obj(g);
    const work = group ? parseWorkSummary(orcid, group) : null;
    if (work) works.push(work);
  }
  return works;
}

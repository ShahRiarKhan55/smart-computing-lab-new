import { z } from "zod";

/**
 * Phase 3C: optional research-profile links (Google Scholar, ResearchGate, ORCID).
 *
 * One strict validator per service, shared by the admin team form and the own-profile form (and re-run by the server on
 * every write, so the web client is never trusted). "" always means "no link". Each validator returns the CANONICAL URL, which
 * is what gets stored: that keeps stored values uniform and strips tracking parameters/fragments the user pasted along.
 *
 * http:// and https:// input are both accepted and always normalised to https://. Deliberately NOT built on `new URL()`: a hand-written, anchored pattern per service rejects credentials, ports, backslashes,
 * whitespace, percent-encoded hosts, IDN/punycode look-alikes, non-https schemes and extra path segments by construction,
 * and behaves identically in the browser, on the server and in the Node unit tests.
 */

/** Maximum accepted input length (a real profile URL is far shorter). */
const MAX_INPUT = 300;

/** Optional "?query" and "#fragment" tail: only URL-safe characters, no whitespace or control characters. */
const TAIL = /^(?:\?[A-Za-z0-9._~%!$&'()*+,;=:@/?-]*)?(?:#[A-Za-z0-9._~%!$&'()*+,;=:@/?-]*)?$/;

/**
 * Hosts of Google Scholar, as an exact allow-list (never a wildcard or suffix match).
 * Evidence: Google's list of country domains (https://www.google.com/supported_domains, fetched 2026-10-27) is only the CANDIDATE set, it
 * does not prove Scholar is served on each. Each candidate "scholar.google.<tld>" was therefore resolved in public DNS on 2026-10-27 and
 * kept only if it is a CNAME to Google's own Scholar service name "scholar.l.google.com" (73 of the 187 candidates); the 114 that do not
 * resolve were excluded rather than guessed. See docs/architecture/phase3c-research-links.md ("Google Scholar hostname evidence").
 */
const GOOGLE_SCHOLAR_TLDS: readonly string[] = [
  "ae", "at", "be", "bg", "ca", "cat", "ch", "cl", "co.cr", "co.id", "co.il", "co.in", "co.jp", "co.kr",
  "co.nz", "co.th", "co.uk", "co.ve", "co.za", "com", "com.ar", "com.au", "com.bo", "com.br", "com.co",
  "com.cu", "com.do", "com.ec", "com.eg", "com.gt", "com.hk", "com.ly", "com.mx", "com.my", "com.ni", "com.pa",
  "com.pe", "com.ph", "com.pk", "com.pr", "com.py", "com.sg", "com.sv", "com.tr", "com.tw", "com.ua", "com.uy",
  "com.vn", "cz", "de", "dk", "es", "fi", "fr", "gr", "hn", "hr", "hu", "is", "it", "li", "lt", "lu", "lv",
  "nl", "no", "pl", "pt", "ro", "ru", "se", "si", "sk",
];
const SCHOLAR_HOSTS: ReadonlySet<string> = new Set(GOOGLE_SCHOLAR_TLDS.map((t) => `scholar.google.${t}`));
/** Exposed for tests only. */
export const GOOGLE_SCHOLAR_HOSTS: readonly string[] = [...SCHOLAR_HOSTS];

/** A Scholar user id is 12 characters of [A-Za-z0-9_-]. */
const SCHOLAR_ID = /^[A-Za-z0-9_-]{12}$/;
/** Query parameters Scholar profile links commonly carry; `user` is the only one kept. */
const SCHOLAR_PARAMS = new Set(["user", "hl", "view_op", "oi", "sciund", "authuser"]);

export const RESEARCH_LINK_MESSAGES = {
  tooLong: "Research link is too long.",
  googleScholar: "Google Scholar link must be a profile URL like https://scholar.google.com/citations?user=XXXXXXXXXXXX.",
  researchGate: "ResearchGate link must be a profile URL like https://www.researchgate.net/profile/Your-Name.",
  orcid: "ORCID must be a valid iD such as 0000-0002-1825-0097 or https://orcid.org/0000-0002-1825-0097.",
} as const;

/** Splits "http(s)://host/path?query#fragment" into parts, or null for anything that is not a plain http(s) URL with no credentials or port (the scheme is not kept: callers always rebuild an https URL). */
function splitHttps(v: string): { host: string; path: string; tail: string } | null {
  const m = /^https?:\/\/([A-Za-z0-9.-]+)(\/[^?#]*)?([?#].*)?$/i.exec(v);
  if (!m) return null;
  const tail = m[3] ?? "";
  if (tail !== "" && !TAIL.test(tail)) return null;
  return { host: m[1].toLowerCase(), path: m[2] ?? "", tail };
}

function queryOf(tail: string): string {
  if (!tail.startsWith("?")) return "";
  const end = tail.indexOf("#");
  return tail.slice(1, end === -1 ? undefined : end);
}

/** Canonical Scholar profile URL, or null when `raw` is not one. */
export function normalizeGoogleScholarUrl(raw: string): string | null {
  const v = raw.trim();
  if (v.length === 0 || v.length > MAX_INPUT) return null;
  const u = splitHttps(v);
  if (!u || !SCHOLAR_HOSTS.has(u.host)) return null;
  if (u.path !== "/citations" && u.path !== "/citations/") return null;
  const q = queryOf(u.tail);
  if (q === "") return null;
  let user: string | null = null;
  for (const pair of q.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const val = eq === -1 ? "" : pair.slice(eq + 1);
    if (!SCHOLAR_PARAMS.has(key)) return null;
    if (key === "user") {
      if (user !== null) return null;
      user = val;
    }
  }
  if (user === null || !SCHOLAR_ID.test(user)) return null;
  return `https://${u.host}/citations?user=${user}`;
}

/** ResearchGate profile slugs: letters, digits, "-", "_", "." (e.g. "Jane-Doe-12"). */
const RG_SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,99}$/;

/** Canonical ResearchGate profile URL (https://www.researchgate.net/profile/<slug>), or null. */
export function normalizeResearchGateUrl(raw: string): string | null {
  const v = raw.trim();
  if (v.length === 0 || v.length > MAX_INPUT) return null;
  const u = splitHttps(v);
  if (!u || (u.host !== "researchgate.net" && u.host !== "www.researchgate.net")) return null;
  const m = /^\/profile\/([^/]+)\/?$/.exec(u.path);
  if (!m || !RG_SLUG.test(m[1])) return null;
  return `https://www.researchgate.net/profile/${m[1]}`;
}

/** ISO 7064 MOD 11-2 check character over the first 15 digits of an ORCID iD. */
export function orcidCheckChar(first15: string): string {
  let total = 0;
  for (const ch of first15) total = (total + Number(ch)) * 2;
  const result = (12 - (total % 11)) % 11;
  return result === 10 ? "X" : String(result);
}

/** Canonical ORCID URL (https://orcid.org/<id>) from a bare iD or an orcid.org URL, or null. Check digit is verified. */
export function normalizeOrcidUrl(raw: string): string | null {
  const v = raw.trim();
  if (v.length === 0 || v.length > MAX_INPUT) return null;
  let id = v;
  if (v.includes("/")) {
    const u = splitHttps(v);
    if (!u || (u.host !== "orcid.org" && u.host !== "www.orcid.org")) return null;
    const m = /^\/([^/]+)\/?$/.exec(u.path);
    if (!m) return null;
    id = m[1];
  }
  const m = /^(\d{4})-(\d{4})-(\d{4})-(\d{3}[\dX])$/.exec(id);
  if (!m) return null;
  const digits = m[1] + m[2] + m[3] + m[4];
  if (orcidCheckChar(digits.slice(0, 15)) !== digits[15]) return null;
  return `https://orcid.org/${id}`;
}

/** Read-time re-check of a STORED value (defence in depth: only a canonical, valid link is ever rendered). */
export const isGoogleScholarUrl = (v: unknown): v is string => typeof v === "string" && normalizeGoogleScholarUrl(v) === v;
export const isResearchGateUrl = (v: unknown): v is string => typeof v === "string" && normalizeResearchGateUrl(v) === v;
export const isOrcidUrl = (v: unknown): v is string => typeof v === "string" && normalizeOrcidUrl(v) === v;

function optionalLink(normalize: (raw: string) => string | null, message: string) {
  return z
    .string({ invalid_type_error: message })
    .max(MAX_INPUT * 4, RESEARCH_LINK_MESSAGES.tooLong)
    .transform((s, ctx) => {
      const t = s.trim();
      if (t === "") return "";
      const out = normalize(t);
      if (out === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return out;
    });
}

export const optionalGoogleScholarUrl = () => optionalLink(normalizeGoogleScholarUrl, RESEARCH_LINK_MESSAGES.googleScholar);
export const optionalResearchGateUrl = () => optionalLink(normalizeResearchGateUrl, RESEARCH_LINK_MESSAGES.researchGate);
export const optionalOrcidUrl = () => optionalLink(normalizeOrcidUrl, RESEARCH_LINK_MESSAGES.orcid);

/** The three optional link fields as a block, spread into team/profile schemas. */
export const researchLinkFields = {
  googleScholarUrl: optionalGoogleScholarUrl(),
  researchGateUrl: optionalResearchGateUrl(),
  orcidUrl: optionalOrcidUrl(),
};

/**
 * Researcher profile links (Phase 27 / P27.3): Google Scholar, ResearchGate and ORCID.
 *
 * Nothing here ever BUILDS a link from a name or guesses an id — a link exists only because a
 * person (or an administrator) typed it. Validation is per service, not just "any URL": an http(s)
 * URL on the service's own host, with no embedded credentials, so a profile link cannot be used to
 * smuggle a `javascript:` URL or point visitors at an unrelated site under a trusted icon.
 *
 * ORCID is stored as the bare iD (0000-0002-1825-0097) after checking its ISO 7064 mod 11-2 check
 * digit, and displayed as `https://orcid.org/<iD>`; the same normalized iD drives the publication
 * importer, so a mistyped iD is refused here rather than silently importing nothing.
 */
import { z } from "zod";

export const PROFILE_LINK_MAX = 2048;

function parseHttpUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url;
}

export function isGoogleScholarUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  return !!url && /^scholar\.google\.(?:com|co\.[a-z]{2}|[a-z]{2,3})$/.test(url.hostname.toLowerCase());
}

export function isResearchGateUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === "researchgate.net" || host === "www.researchgate.net";
}

/** ISO 7064 mod 11-2 check character for the first 15 digits of an ORCID iD. */
function orcidCheckChar(first15: string): string {
  let total = 0;
  for (const ch of first15) total = (total + Number(ch)) * 2;
  const result = (12 - (total % 11)) % 11;
  return result === 10 ? "X" : String(result);
}

/** The canonical `0000-0000-0000-000X` iD inside `input` (a bare iD or an orcid.org link), or `null`. */
export function normalizeOrcid(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (value === "" || value.length > PROFILE_LINK_MAX) return null;
  const link = /^(?:https?:\/\/)?(?:www\.)?orcid\.org\/(.+)$/i.exec(value);
  if (link) value = link[1].replace(/[?#].*$/, "").replace(/\/+$/, "");
  const compact = value.replace(/-/g, "").toUpperCase();
  if (!/^\d{15}[\dX]$/.test(compact)) return null;
  // Dashes, if present, must be in the canonical places (a stray dash is a typo, not an iD).
  if (value.includes("-") && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dXx]$/.test(value)) return null;
  if (orcidCheckChar(compact.slice(0, 15)) !== compact[15]) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12)}`;
}

export const orcidToUrl = (orcid: string): string => `https://orcid.org/${orcid}`;

export const SCHOLAR_INVALID_MESSAGE = "Google Scholar link must be a https://scholar.google.com/… profile URL.";
export const RESEARCHGATE_INVALID_MESSAGE = "ResearchGate link must be a https://www.researchgate.net/… profile URL.";
export const ORCID_INVALID_MESSAGE = "ORCID must be a valid iD such as 0000-0002-1825-0097 (or its https://orcid.org/… link).";

/** "" = none; otherwise a Google Scholar URL. */
export const scholarUrlField = z
  .string({ invalid_type_error: "Google Scholar link must be text." })
  .trim()
  .max(PROFILE_LINK_MAX, SCHOLAR_INVALID_MESSAGE)
  .refine((v) => v === "" || isGoogleScholarUrl(v), SCHOLAR_INVALID_MESSAGE);

/** "" = none; otherwise a ResearchGate URL. */
export const researchGateUrlField = z
  .string({ invalid_type_error: "ResearchGate link must be text." })
  .trim()
  .max(PROFILE_LINK_MAX, RESEARCHGATE_INVALID_MESSAGE)
  .refine((v) => v === "" || isResearchGateUrl(v), RESEARCHGATE_INVALID_MESSAGE);

/** "" = none; otherwise a checksum-valid iD (or orcid.org link), stored as the bare iD. */
export const orcidField = z
  .string({ invalid_type_error: "ORCID must be text." })
  .trim()
  .max(PROFILE_LINK_MAX, ORCID_INVALID_MESSAGE)
  .transform((value, ctx) => {
    if (value === "") return "";
    const id = normalizeOrcid(value);
    if (!id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: ORCID_INVALID_MESSAGE });
      return z.NEVER;
    }
    return id;
  });

export interface ProfileLink {
  kind: "scholar" | "researchgate" | "orcid";
  href: string;
}

/** The profile links a person actually has, in display order. Absent ones are simply omitted. */
export function profileLinksOf(member: { scholarUrl?: string; researchGateUrl?: string; orcid?: string }): ProfileLink[] {
  const links: ProfileLink[] = [];
  if (member.scholarUrl && isGoogleScholarUrl(member.scholarUrl)) links.push({ kind: "scholar", href: member.scholarUrl });
  if (member.researchGateUrl && isResearchGateUrl(member.researchGateUrl)) links.push({ kind: "researchgate", href: member.researchGateUrl });
  const orcid = member.orcid ? normalizeOrcid(member.orcid) : null;
  if (orcid) links.push({ kind: "orcid", href: orcidToUrl(orcid) });
  return links;
}

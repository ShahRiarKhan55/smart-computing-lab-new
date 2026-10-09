/**
 * DOI handling (Phase 27 / P27.7). A DOI is entered by people in many shapes — bare
 * (`10.1234/example`), with a `doi:` label, or as a resolver link (`https://doi.org/…`,
 * `https://dx.doi.org/…`, sometimes pasted twice). Everything funnels through `normalizeDoi`, which
 * is the single definition of "a valid DOI" used by the web form (courtesy feedback), the API schema
 * (the authority) and the publication importer (deduplication).
 *
 * Canonical forms:
 * - the identifier itself is stored/compared WITHOUT any resolver prefix (`10.1234/Example`);
 *   its case is preserved for display (publishers print mixed case) but DOIs are case-insensitive,
 *   so every comparison goes through `doiKey` (lower-cased);
 * - the link shown to users is always `doiToUrl(doi)` = `https://doi.org/<doi>`.
 *
 * Deliberately lenient about the suffix: the DOI handbook allows nearly any printable characters
 * after the first `/`, so only whitespace and control characters (and "." / ".." path segments) are refused. Strict about the
 * prefix: `10.` + digits (+ optional `.digits` sub-registrants) + `/`. An arbitrary URL is never
 * accepted as a DOI.
 */

const RESOLVER_PREFIX = /^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i;
const LABEL_PREFIX = /^doi\s*:\s*/i;
const DOI_SHAPE = /^10\.\d+(?:\.\d+)*\/[^\s\u0000-\u001f\u007f]+$/;

export const DOI_INVALID_MESSAGE = "Enter a DOI such as 10.1234/example (the https://doi.org/ prefix is optional).";

/** Strips any number of leading resolver/label prefixes (so a doubled prefix is harmless). */
function stripPrefixes(input: string): { value: string; viaResolver: boolean } {
  let value = input.trim();
  let viaResolver = false;
  for (let i = 0; i < 10; i++) {
    if (RESOLVER_PREFIX.test(value)) {
      viaResolver = true;
      value = value.replace(RESOLVER_PREFIX, "").trim();
    } else if (LABEL_PREFIX.test(value)) {
      value = value.replace(LABEL_PREFIX, "").trim();
    } else {
      break;
    }
  }
  return { value, viaResolver };
}

/**
 * The bare DOI inside `input`, or `null` if `input` is not a DOI. Accepts a bare DOI, a `doi:`
 * label, or a doi.org / dx.doi.org link (any case, with or without a scheme); drops a resolver
 * link's query string / fragment. Rejects anything else — including any other website's URL.
 */
export function normalizeDoi(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw === "" || raw.length > 2048) return null;

  let { value } = stripPrefixes(raw);
  const { viaResolver } = stripPrefixes(raw);
  if (viaResolver) {
    // A resolver LINK may carry tracking params / a fragment and percent-encoded characters.
    value = value.replace(/[?#].*$/, "");
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  if (!DOI_SHAPE.test(value)) return null;
  // A "." or ".." path segment would be collapsed by any URL parser, letting a DOI escape the `/works/…` (or
  // doi.org) path it is placed under. No real DOI has one; refuse it (checked AFTER percent-decoding above).
  if (value.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return value;
}

/** The comparison key: case-insensitive, prefix-free. `null` when `input` is not a DOI. */
export function doiKey(input: unknown): string | null {
  const doi = normalizeDoi(input);
  return doi ? doi.toLowerCase() : null;
}

/** `https://doi.org/<doi>` with each path segment percent-encoded (the `/` separators are kept). */
export function doiToUrl(doi: string): string {
  return `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
}

/** The bare DOI behind a stored link (an existing `doiUrl`), or `null` if it is not a DOI link. */
export function doiFromUrl(url: unknown): string | null {
  return normalizeDoi(url);
}

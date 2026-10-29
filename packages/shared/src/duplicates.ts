import { z } from "zod";

/**
 * Duplicate detection for curated content (team profiles, publications, news, research areas).
 *
 * Everything here is PURE (no I/O): the normalisers and the matchers, shared by the API (which enforces them inside the writing
 * transaction, see apps/server/src/lib/duplicates.ts) and the web client (which only renders the conflict it is sent).
 *
 * A match is a WARNING that two records MAY be the same real-world thing, never proof. Two people can share a name; a preprint, a
 * conference paper and its journal extension are distinct publications; an announcement can recur on different dates. So:
 *  - the API answers 409 with a machine-readable body and the matching records;
 *  - an explicit `confirmDuplicate: true` from an authorised actor (`canOverrideDuplicate`) records the new item anyway;
 *  - the one exception is an identical canonical DOI, which names the same work by definition (not overridable).
 * Nothing here is a database constraint; existing duplicates are never touched, and an edit is only checked on the field(s) that
 * the edit actually changes.
 */

export const DUPLICATE_CODE = "DUPLICATE_CANDIDATE" as const;

export type DuplicateKind =
  | "team-name"
  | "publication-doi"
  | "publication-title-year"
  | "news-title-date"
  | "research-title";

/** One existing record that a new/edited record resembles. Only fields the requester may already see. */
export interface DuplicateCandidate {
  id: string;
  /** Human label (a name or a title). */
  label: string;
  /** Short context: category, year, date, tag. */
  detail?: string;
}

/** The body of the 409 answer. `error` is the human message; the rest is machine-readable. */
export interface DuplicateConflictBody {
  error: string;
  code: typeof DUPLICATE_CODE;
  kind: DuplicateKind;
  /** True when an authorised actor may repeat the request with `confirmDuplicate: true`. */
  overridable: boolean;
  /** True when THIS requester is allowed to send the override (false: ask a lab manager or admin). */
  canOverride: boolean;
  candidates: DuplicateCandidate[];
}

/**
 * The fixed English API messages of the duplicate conflict (the web client maps each to a translation key, as for the alumni
 * messages). They never contain the matching record's name or title: those travel in `candidates`, filtered to what the requester may see.
 */
export const DUPLICATE_MESSAGES: Record<DuplicateKind, string> = {
  "team-name": "A team profile with a very similar name already exists. If this is a different person, a lab manager or admin can confirm it and save anyway.",
  "publication-doi": "A publication with the same DOI already exists.",
  "publication-title-year": "A publication with the same title and year already exists. If this is a different publication, a lab manager or admin can confirm it and save anyway.",
  "news-title-date": "A news item with the same title and date already exists. If this is a different announcement, a lab manager or admin can confirm it and save anyway.",
  "research-title": "A research area with the same title already exists. If this is a different area, a lab manager or admin can confirm it and save anyway.",
};

/** Answered to an invitee whose chosen profile name matches a profile created AFTER the invitation was issued (no override at that point). */
export const INVITATION_DUPLICATE_MESSAGE =
  "A team profile with this name was created after your invitation was issued. Please contact your administrator.";

/** Optional on every create/update body that is duplicate-checked. Ignored for a requester who may not override. */
export const confirmDuplicateField = z.boolean({ invalid_type_error: "confirmDuplicate must be true or false." }).optional();

/**
 * `.refine` predicate of the update schemas: at least one real field is present. `confirmDuplicate` alone is not a change (it only
 * answers a conflict), so a request that carries nothing else is still "Nothing to update."
 */
export function hasUpdateField(value: Record<string, unknown>): boolean {
  return Object.entries(value).some(([key, v]) => key !== "confirmDuplicate" && v !== undefined);
}

// ---- normalisation ---------------------------------------------------------------------------------------------------------

/**
 * Case-, accent-, punctuation- and whitespace-insensitive form of free text, for COMPARISON only (never stored or shown).
 *  - NFKC folds compatibility forms (full-width letters, ligatures);
 *  - accents are removed from LATIN letters only (so Japanese voiced marks, which are combining marks too, are kept: か != が);
 *  - "&" reads as "and" ("Wafer & Semiconductor" = "Wafer and Semiconductor");
 *  - everything else that is not a letter or a digit (any script) becomes one space.
 */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Honorifics/ranks that are not part of the person's name. Deliberately short and explicit. */
const NAME_TITLES: ReadonlySet<string> = new Set(["dr", "prof", "professor", "assistant", "associate", "mr", "mrs", "ms", "mx"]);

/**
 * Comparison key for a person's name: normalised, honorifics removed, tokens sorted so "Wang Weiquan" and "Weiquan Wang" (family-name
 * order) give the same key. Two different people can share it, which is exactly why a match is only a warning.
 */
export function personNameKey(name: string | null | undefined): string {
  const tokens = normalizeText(name).split(" ").filter(Boolean);
  const core = tokens.filter((t) => !NAME_TITLES.has(t));
  return (core.length > 0 ? core : tokens).sort().join(" ");
}

const DOI_PATTERN = /(?:^|[/:\s=])(10\.\d{4,9}\/[^\s"'<>?#]+)/i;

/**
 * The canonical DOI ("10.1234/abc") inside a DOI URL, a `doi:` string or a publisher URL, lower-cased with trailing punctuation
 * removed; or null when the text holds none. `https://doi.org/10.1145/3765907`, `http://dx.doi.org/10.1145/3765907`, `doi:10.1145/3765907`
 * and `https://dl.acm.org/doi/10.1145/3765907?utm_source=x` all give `10.1145/3765907`.
 */
export function canonicalDoi(input: string | null | undefined): string | null {
  if (!input) return null;
  let text = input.trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    /* keep the raw text */
  }
  const match = DOI_PATTERN.exec(text);
  if (!match) return null;
  const doi = match[1].replace(/[.,;:)\]}/]+$/, "").toLowerCase();
  return /^10\.\d{4,9}\/.+/.test(doi) ? doi : null;
}

// ---- matchers (pure) -------------------------------------------------------------------------------------------------------

export interface NamedRecord {
  id: string;
  name: string;
}

/** Existing records whose name has the same {@link personNameKey} as `name`. An empty key never matches. */
export function findNameMatches<T extends NamedRecord>(name: string, existing: readonly T[], excludeId?: string): T[] {
  const key = personNameKey(name);
  if (!key) return [];
  return existing.filter((e) => e.id !== excludeId && personNameKey(e.name) === key);
}

export interface PublicationLike {
  id: string;
  title: string;
  year: number;
  doiUrl: string;
}

export interface PublicationMatch<T extends PublicationLike> {
  kind: "doi" | "title-year";
  record: T;
}

/**
 * Publications the candidate may duplicate.
 *  - Both have a canonical DOI: the same DOI is the same work (kind "doi", not overridable); DIFFERENT DOIs are distinct works even
 *    when the title is identical (a preprint, a conference paper and its journal extension each have their own DOI).
 *  - Otherwise (at least one has no DOI): the same normalised title AND the same year is a likely duplicate (kind "title-year").
 *    The same title in another year is allowed.
 */
export function findPublicationMatches<T extends PublicationLike>(
  candidate: { title: string; year: number; doiUrl: string },
  existing: readonly T[],
  excludeId?: string,
): PublicationMatch<T>[] {
  const doi = canonicalDoi(candidate.doiUrl);
  const title = normalizeText(candidate.title);
  const out: PublicationMatch<T>[] = [];
  for (const e of existing) {
    if (e.id === excludeId) continue;
    const eDoi = canonicalDoi(e.doiUrl);
    if (doi && eDoi) {
      if (doi === eDoi) out.push({ kind: "doi", record: e });
      continue;
    }
    if (title && title === normalizeText(e.title) && candidate.year === e.year) out.push({ kind: "title-year", record: e });
  }
  return out;
}

export interface NewsLike {
  id: string;
  title: string;
  dateLabel: string;
  sortDate: string;
}

/**
 * News items with the same normalised title on the same date: either the same display date (normalised, so "May 2025" = "may 2025") or
 * the same sort date. The same title on a different date is a recurring announcement and is allowed.
 */
export function findNewsMatches<T extends NewsLike>(
  candidate: { title: string; dateLabel: string; sortDate: string },
  existing: readonly T[],
  excludeId?: string,
): T[] {
  const title = normalizeText(candidate.title);
  if (!title) return [];
  const label = normalizeText(candidate.dateLabel);
  return existing.filter(
    (e) =>
      e.id !== excludeId &&
      normalizeText(e.title) === title &&
      ((label !== "" && normalizeText(e.dateLabel) === label) || (candidate.sortDate !== "" && e.sortDate === candidate.sortDate)),
  );
}

export interface ResearchAreaLike {
  id: string;
  title: string;
}

/** Comparison key of a research-area title: normalised, with the words sorted so the same words in another order give the same key. */
export function researchTitleKey(title: string | null | undefined): string {
  return normalizeText(title).split(" ").filter(Boolean).sort().join(" ");
}

/**
 * Research areas whose title matches the candidate's: the same normalised words, in any order ("&" and "and" are the same word, so
 * "AI & Machine Learning" matches "machine learning and AI").
 *
 * The TAG is deliberately NOT a duplicate signal. A tag is a category label that several different areas share by design, and no
 * similarity threshold separates "Machine Learning Hardware" from a repeat of "Machine Learning": every rule tried (shared tag plus a
 * large word overlap, plus a one-word difference) flagged distinct pairs that this repository's own regression fixtures create. The tag
 * is shown next to each candidate so a reviewer can judge for themselves.
 */
export function findResearchAreaMatches<T extends ResearchAreaLike>(candidate: { title: string }, existing: readonly T[], excludeId?: string): T[] {
  const key = researchTitleKey(candidate.title);
  if (!key) return [];
  return existing.filter((e) => e.id !== excludeId && researchTitleKey(e.title) === key);
}

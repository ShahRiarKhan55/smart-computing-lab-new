import { canonicalDoi, findPublicationMatches, normalizeText } from "@scl/shared";
import type { Candidate, MappedFields } from "./map.js";

/**
 * Classifies every candidate against the publications already in the database (and against the other candidates), WITHOUT writing
 * anything. The duplicate rules are the application's own (`findPublicationMatches` in packages/shared: identical canonical DOI, or the same
 * normalised title + year when a DOI is missing on either side; distinct DOIs are distinct publications), plus one advisory check for a
 * title that CONTAINS an existing title.
 *
 *   new                  nothing resembles it: will be created
 *   existing-match       the same publication is already stored (identical title, year, venue and authors): nothing to do
 *   conflict             an existing record matches by DOI or title+year but DIFFERS in a core field: a human decides, nothing is overwritten
 *   possible-match       no exact rule fires but an existing title is contained in this one (e.g. an "(Accepted)" suffix): a human decides
 *   duplicate-in-source  another record of the same file already stands for it
 *   invalid              cannot be imported as it stands (see its errors)
 */

export interface ExistingPublication {
  id: string;
  title: string;
  authors: string;
  venue: string;
  year: number;
  doiUrl: string;
  status: string;
  pubMonth: number;
  volume: string;
  pageStart: string;
  pageEnd: string;
  issn: string;
  isbn: string;
  category: string;
  acceptedDate: string;
}

export type Disposition = "new" | "existing-match" | "conflict" | "possible-match" | "duplicate-in-source" | "invalid";

export interface FieldDiff {
  field: string;
  existing: string;
  incoming: string;
}

export interface PlanMatch {
  id: string;
  title: string;
  year: number;
  via: "doi" | "title-year" | "contained-title";
}

export interface PlanEntry {
  candidate: Candidate;
  disposition: Disposition;
  reasons: string[];
  matches: PlanMatch[];
  diffs: FieldDiff[];
  /** True when an authorised human may declare the record distinct (never for an identical DOI). */
  confirmable: boolean;
}

export interface Plan {
  entries: PlanEntry[];
  counts: Record<Disposition, number> & { total: number };
}

/** Fields compared to decide whether a matching record is "the same publication" or a conflict. */
function coreDiffs(incoming: MappedFields, existing: ExistingPublication): FieldDiff[] {
  const out: FieldDiff[] = [];
  const text = (field: "title" | "venue" | "authors") => {
    if (normalizeText(incoming[field]) !== normalizeText(existing[field])) out.push({ field, existing: existing[field], incoming: incoming[field] });
  };
  text("title");
  if (incoming.year !== existing.year) out.push({ field: "year", existing: String(existing.year), incoming: String(incoming.year) });
  text("venue");
  text("authors");
  return out;
}

/** The shorter title's words all appear in the longer one, it has at least four words, and the years are at most one apart. */
export function containedTitle(a: { title: string; year: number }, b: { title: string; year: number }): boolean {
  const x = new Set(normalizeText(a.title).split(" ").filter(Boolean));
  const y = new Set(normalizeText(b.title).split(" ").filter(Boolean));
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  if (small.size < 4 || Math.abs(a.year - b.year) > 1) return false;
  for (const w of small) if (!large.has(w)) return false;
  return true;
}

export function planImport(candidates: Candidate[], existing: readonly ExistingPublication[]): Plan {
  const entries: PlanEntry[] = [];
  const seenDoi = new Map<string, number>();
  const seenTitleYear = new Map<string, number>();

  for (const candidate of candidates) {
    const f = candidate.fields;
    if (candidate.errors.length > 0 || f.year === null) {
      entries.push({ candidate, disposition: "invalid", reasons: candidate.errors.map((e) => e.message), matches: [], diffs: [], confirmable: false });
      continue;
    }
    const year = f.year;
    const doi = canonicalDoi(f.doiUrl);
    const titleYear = `${normalizeText(f.title)}|${year}`;

    // Within the file first: the earlier importable record stands for the later one.
    const earlier = (doi && seenDoi.get(doi)) || seenTitleYear.get(titleYear);
    if (earlier) {
      entries.push({ candidate, disposition: "duplicate-in-source", reasons: [`Record ${earlier} of the same file has the same ${doi && seenDoi.get(doi) ? "DOI" : "title and year"}.`], matches: [], diffs: [], confirmable: false });
      continue;
    }
    if (doi) seenDoi.set(doi, candidate.ordinal);
    seenTitleYear.set(titleYear, candidate.ordinal);

    const found = findPublicationMatches({ title: f.title, year, doiUrl: f.doiUrl }, existing);
    if (found.length > 0) {
      const matches: PlanMatch[] = found.map((m) => ({ id: m.record.id, title: m.record.title, year: m.record.year, via: m.kind === "doi" ? "doi" : "title-year" }));
      const diffs = found.flatMap((m) => coreDiffs({ ...f, year }, m.record));
      const viaDoi = found.some((m) => m.kind === "doi");
      if (diffs.length === 0) {
        entries.push({ candidate, disposition: "existing-match", reasons: [`Already stored (matched by ${viaDoi ? "DOI" : "title and year"}); title, year, venue and authors are identical.`], matches, diffs, confirmable: false });
      } else {
        entries.push({
          candidate,
          disposition: "conflict",
          reasons: [`Matches an existing record by ${viaDoi ? "DOI" : "title and year"} but differs in: ${[...new Set(diffs.map((d) => d.field))].join(", ")}. Nothing was changed.`],
          matches,
          diffs,
          confirmable: !viaDoi,
        });
      }
      continue;
    }

    const similar = existing.filter((e) => {
      const eDoi = canonicalDoi(e.doiUrl);
      return !(doi && eDoi) && containedTitle({ title: f.title, year }, e);
    });
    if (similar.length > 0) {
      entries.push({
        candidate,
        disposition: "possible-match",
        reasons: ["An existing publication's title is contained in this record's title (and the years are within one) but no exact rule fires. It may be the same paper under a longer title. Decide before importing."],
        matches: similar.map((e) => ({ id: e.id, title: e.title, year: e.year, via: "contained-title" })),
        diffs: similar.flatMap((e) => coreDiffs({ ...f, year }, e)),
        confirmable: true,
      });
      continue;
    }
    entries.push({ candidate, disposition: "new", reasons: [], matches: [], diffs: [], confirmable: false });
  }

  const counts = { total: entries.length, new: 0, "existing-match": 0, conflict: 0, "possible-match": 0, "duplicate-in-source": 0, invalid: 0 } as Plan["counts"];
  for (const e of entries) counts[e.disposition]++;
  return { entries, counts };
}

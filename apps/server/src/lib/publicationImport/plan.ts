import { canonicalDoi, findPublicationMatches, normalizeText } from "@scl/shared";
import type { Decision, Decisions } from "./decisions.js";
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
 *   invalid              cannot be imported as it stands (see its errors), or a review decision keeps it blocked
 *
 * Review decisions (decisions.ts) are applied AFTER this classification and only ever make it more cautious or more specific:
 *   update-required      a decision prefers the spreadsheet's value for a field of a stored record (same DOI). REPORTED ONLY: nothing is changed
 *                        unless the operator explicitly runs the decided updates (apply.ts), and then only if the stored value is unchanged
 *   confirmed-match      a decision says this record IS a stored publication: it is never created and the stored record is not touched
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
  /** Fields (title / venue) that already have a Japanese override on this record; informational, for the report. */
  jaOverrides?: string[];
}

export type Disposition = "new" | "existing-match" | "conflict" | "possible-match" | "duplicate-in-source" | "invalid" | "update-required" | "confirmed-match";

export interface FieldDiff {
  field: string;
  existing: string;
  incoming: string;
}

export interface PlanMatch {
  id: string;
  title: string;
  year: number;
  via: "doi" | "title-year" | "contained-title" | "review-decision";
}

export interface PlanEntry {
  candidate: Candidate;
  disposition: Disposition;
  reasons: string[];
  matches: PlanMatch[];
  diffs: FieldDiff[];
  /** True when an authorised human may declare the record distinct (never for an identical DOI). */
  confirmable: boolean;
  /** For update-required: the field changes a review decision asks for (stored value -> spreadsheet value). */
  updates: FieldDiff[];
  /** Differences from the stored record that NO decision covers: they stay exactly as stored. */
  undecided: FieldDiff[];
  /** Cautions for the reader (for example: a Japanese override exists for a field that is about to change). */
  notes: string[];
  /** The review decision that shaped this entry, if any. */
  decision?: Decision;
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

type BaseEntry = Omit<PlanEntry, "updates" | "undecided" | "notes" | "decision">;

/** Classification without any review decision (the behaviour before decisions existed). */
function classify(candidates: Candidate[], existing: readonly ExistingPublication[]): BaseEntry[] {
  const entries: BaseEntry[] = [];
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
  return entries;
}

const same = (a: unknown, b: unknown) => String(a) === String(b);

/** Applies one review decision to a classified entry. It can block, confirm or ask for an explicit update; it never creates and never writes. */
function decide(entry: PlanEntry, decision: Decision, existing: readonly ExistingPublication[]): PlanEntry {
  const c = entry.candidate;
  const out: PlanEntry = { ...entry, decision };
  const block = (code: string, message: string): PlanEntry => {
    c.errors.push({ level: "error", code, message });
    return { ...out, disposition: "invalid", reasons: [...c.errors.map((e) => e.message)], confirmable: false, updates: [], matches: [] };
  };
  if (!c.fields.title.toLowerCase().startsWith(decision.expectTitle.toLowerCase())) {
    return block("decision-mismatch", `A review decision exists for record ${c.ordinal} but its expectTitle ("${decision.expectTitle}") does not match this record's title, so the record is blocked until the decision is re-reviewed.`);
  }

  if (decision.decision === "keep-blocked") {
    // The mapper's generic advice ("supply one in the overrides file") no longer applies: the reviewer decided the record stays out.
    for (const e of c.errors) e.message = e.message.replace(/ Supply one in the overrides file after checking the source\./, " (Held back by a review decision, see below.)");
    return block("blocked-by-review", `Blocked by a review decision: ${decision.reason}`);
  }
  if (entry.disposition === "invalid") return out; // already blocked for its own reasons; a decision cannot unblock it

  if (decision.decision === "same-as-existing") {
    const target = existing.find((e) => canonicalDoi(e.doiUrl) === decision.existingDoi);
    if (!target) {
      return block("decision-target-missing", `A review decision says this record is the stored publication with DOI ${decision.existingDoi}, but this database has no such record. It is not created; check the target database.`);
    }
    return {
      ...out,
      disposition: "confirmed-match",
      reasons: [`Confirmed by review as the same publication as the stored record with DOI ${decision.existingDoi}${decision.note ? ` (${decision.note})` : ""}. It is not created and the stored record is not changed.`],
      matches: [{ id: target.id, title: target.title, year: target.year, via: "review-decision" }],
      diffs: coreDiffsOf(c, target),
      undecided: coreDiffsOf(c, target),
      confirmable: false,
    };
  }

  // prefer-source: only for a stored record with the SAME DOI
  const matched = entry.matches.length === 1 && entry.matches[0].via === "doi" ? existing.find((e) => e.id === entry.matches[0].id) : undefined;
  if (!matched) {
    return { ...out, notes: ["A prefer-source decision applies only to a stored record with the same DOI; none was found, so nothing is asked of it."] };
  }
  const updates: FieldDiff[] = [];
  const notes: string[] = [];
  for (const [field, spec] of Object.entries(decision.fields)) {
    const have = (matched as unknown as Record<string, unknown>)[field];
    const want = (c.fields as unknown as Record<string, unknown>)[field];
    if (same(have, want)) {
      notes.push(`${field}: the stored value already equals the spreadsheet's (decision already carried out).`);
    } else if (want === "" || want === 0 || want === null || want === undefined) {
      notes.push(`${field}: the spreadsheet states no value, so the decision cannot replace the stored one.`);
    } else if (!same(have, spec!.expectExisting)) {
      notes.push(`${field}: the stored value is "${String(have)}" but the reviewer saw "${String(spec!.expectExisting)}"; the decision is stale and is NOT applied.`);
    } else {
      updates.push({ field, existing: String(have), incoming: String(want) });
      if ((field === "venue" || field === "title") && matched.jaOverrides?.includes(field)) notes.push(`The stored record has a Japanese ${field} override; review it after the update (it is not changed).`);
    }
  }
  const decidedFields = new Set(Object.keys(decision.fields));
  const undecided = entry.diffs.filter((d) => !decidedFields.has(d.field));
  if (updates.length > 0) {
    return {
      ...out,
      disposition: "update-required",
      reasons: [`Review decision${decision.note ? ` (${decision.note})` : ""}: prefer the spreadsheet value for ${updates.map((u) => u.field).join(", ")}. Reported only: nothing is changed unless the decided updates are run explicitly.`],
      updates,
      undecided,
      notes,
      confirmable: false,
    };
  }
  // nothing to update: keep the classification, with the decision's remarks
  const stillDiffering = undecided.length > 0 || entry.disposition === "conflict";
  return { ...out, disposition: stillDiffering ? entry.disposition : "existing-match", undecided, notes };
}

function coreDiffsOf(c: Candidate, e: ExistingPublication): FieldDiff[] {
  return coreDiffs({ ...c.fields, year: c.fields.year as number }, e);
}

export function planImport(candidates: Candidate[], existing: readonly ExistingPublication[], decisions?: Decisions): Plan {
  const base = classify(candidates, existing);
  const entries: PlanEntry[] = base.map((b) => {
    const entry: PlanEntry = { ...b, updates: [], undecided: [], notes: [] };
    const decision = decisions?.records[String(b.candidate.ordinal)];
    return decision ? decide(entry, decision, existing) : entry;
  });
  const counts = { total: entries.length, new: 0, "existing-match": 0, conflict: 0, "possible-match": 0, "duplicate-in-source": 0, invalid: 0, "update-required": 0, "confirmed-match": 0 } as Plan["counts"];
  for (const e of entries) counts[e.disposition]++;
  return { entries, counts };
}

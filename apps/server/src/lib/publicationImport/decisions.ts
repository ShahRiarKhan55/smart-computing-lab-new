import { canonicalDoi } from "@scl/shared";

/**
 * Review decisions: what a person decided about records the importer could not decide for itself. They are DATA the importer reads, kept in
 * a reviewed file next to the code (scripts/fixtures/publication-list-review-decisions.json), never behaviour it infers.
 *
 *   prefer-source     "the spreadsheet is right about these fields". Never applied automatically: the dry run and a plain --apply only REPORT
 *                     it ("requires an explicit update"). It is carried out only by --apply-decided-updates, and then only if the stored value
 *                     is still exactly `expectExisting`, i.e. what the reviewer saw (compare-and-set).
 *   same-as-existing  "this record IS the stored publication with this DOI". It is never created, and nothing about the stored record changes.
 *   keep-blocked      "this record stays out of the import" (for example: its publication year is unresolved). Takes precedence over an
 *                     overrides file that would unblock it.
 *
 * Every decision names the record by its ordinal AND asserts the start of its title, so a decision can never land on the wrong record after
 * the spreadsheet changes (a mismatch blocks the record instead).
 */

/** Fields a "prefer-source" decision may name. Identity fields (title, DOI) are deliberately absent: they decide WHICH publication it is. */
export const DECIDABLE_FIELDS = ["authors", "venue", "year", "pubMonth", "volume", "pageStart", "pageEnd", "issn", "isbn", "category", "status", "acceptedDate"] as const;
export type DecidableField = (typeof DECIDABLE_FIELDS)[number];

export interface PreferSourceDecision {
  decision: "prefer-source";
  expectTitle: string;
  /** field -> the stored value the reviewer saw (and the update is allowed to replace). */
  fields: Partial<Record<DecidableField, { expectExisting: string | number }>>;
  note?: string;
}
export interface SameAsExistingDecision {
  decision: "same-as-existing";
  expectTitle: string;
  /** The DOI of the stored publication this record is the same as. */
  existingDoi: string;
  note?: string;
}
export interface KeepBlockedDecision {
  decision: "keep-blocked";
  expectTitle: string;
  reason: string;
}
export type Decision = PreferSourceDecision | SameAsExistingDecision | KeepBlockedDecision;

export interface Decisions {
  version: 1;
  records: Record<string, Decision>;
}

export class DecisionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionsError";
  }
}

const NUMERIC: ReadonlySet<string> = new Set(["year", "pubMonth"]);

function exactKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new DecisionsError(`${where}: unknown key "${k}".`);
}

/** Parses and validates a decisions document. Strict: unknown keys, unknown decision kinds and malformed values are refused, never ignored. */
export function parseDecisions(input: unknown): Decisions {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DecisionsError("The decisions file must be a JSON object.");
  const doc = input as Record<string, unknown>;
  exactKeys(doc, ["version", "source", "description", "records"], "decisions");
  if (doc.version !== 1) throw new DecisionsError('The decisions file must have "version": 1.');
  const records = doc.records;
  if (!records || typeof records !== "object" || Array.isArray(records)) throw new DecisionsError('"records" must be an object keyed by record number.');
  const out: Decisions = { version: 1, records: {} };
  for (const [key, raw] of Object.entries(records as Record<string, unknown>)) {
    const where = `record ${key}`;
    if (!/^[1-9]\d{0,3}$/.test(key)) throw new DecisionsError(`${where}: the key must be a record number.`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DecisionsError(`${where}: must be an object.`);
    const d = raw as Record<string, unknown>;
    if (typeof d.expectTitle !== "string" || d.expectTitle.trim().length < 8) throw new DecisionsError(`${where}: "expectTitle" (at least 8 characters of the title) is required.`);
    const expectTitle = d.expectTitle.trim();
    switch (d.decision) {
      case "prefer-source": {
        exactKeys(d, ["decision", "expectTitle", "fields", "note"], where);
        const fields = d.fields;
        if (!fields || typeof fields !== "object" || Array.isArray(fields) || Object.keys(fields).length === 0) throw new DecisionsError(`${where}: "fields" must name at least one field.`);
        const parsed: PreferSourceDecision["fields"] = {};
        for (const [field, spec] of Object.entries(fields as Record<string, unknown>)) {
          if (field === "title" || field === "doiUrl") throw new DecisionsError(`${where}: "${field}" identifies the publication and cannot be the subject of a prefer-source decision.`);
          if (!(DECIDABLE_FIELDS as readonly string[]).includes(field)) throw new DecisionsError(`${where}: "${field}" is not a field a decision can change.`);
          if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new DecisionsError(`${where}.${field}: must be { "expectExisting": <the stored value the reviewer saw> }.`);
          exactKeys(spec as Record<string, unknown>, ["expectExisting"], `${where}.${field}`);
          const expected = (spec as { expectExisting?: unknown }).expectExisting;
          const wantNumber = NUMERIC.has(field);
          if (wantNumber ? typeof expected !== "number" || !Number.isInteger(expected) : typeof expected !== "string") throw new DecisionsError(`${where}.${field}: "expectExisting" must be ${wantNumber ? "a whole number" : "text"}.`);
          parsed[field as DecidableField] = { expectExisting: expected as string | number };
        }
        out.records[key] = { decision: "prefer-source", expectTitle, fields: parsed, ...(typeof d.note === "string" ? { note: d.note } : {}) };
        break;
      }
      case "same-as-existing": {
        exactKeys(d, ["decision", "expectTitle", "existingDoi", "note"], where);
        if (typeof d.existingDoi !== "string" || !canonicalDoi(d.existingDoi)) throw new DecisionsError(`${where}: "existingDoi" must be a DOI.`);
        out.records[key] = { decision: "same-as-existing", expectTitle, existingDoi: canonicalDoi(d.existingDoi)!, ...(typeof d.note === "string" ? { note: d.note } : {}) };
        break;
      }
      case "keep-blocked": {
        exactKeys(d, ["decision", "expectTitle", "reason"], where);
        if (typeof d.reason !== "string" || d.reason.trim().length < 5) throw new DecisionsError(`${where}: "reason" is required.`);
        out.records[key] = { decision: "keep-blocked", expectTitle, reason: d.reason.trim() };
        break;
      }
      default:
        throw new DecisionsError(`${where}: "decision" must be prefer-source, same-as-existing or keep-blocked.`);
    }
  }
  return out;
}

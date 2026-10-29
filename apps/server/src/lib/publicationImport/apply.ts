import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor, Visibility } from "@scl/shared";
import { guardPublication, lockForDuplicateCheck } from "../duplicates.js";
import { recordAudit } from "../audit.js";
import { HttpError } from "../validate.js";
import type { Plan, PlanEntry } from "./plan.js";

/**
 * Writes the planned records. Safe to re-run and to resume: it keeps no state of its own, a re-run re-plans against what is stored (an
 * already imported record is then an "existing-match" and is skipped), and every record is its own transaction, so a failure part-way leaves
 * the records before it complete and the ones after it untouched.
 *
 *  - It ONLY creates records, and (with `fillEmpty`) fills EMPTY bibliographic fields of a record that is already the same publication.
 *    It never updates a non-empty field and never deletes anything.
 *  - Each creation re-runs the application's duplicate guard inside the transaction (write lock first), so a record added by someone else
 *    since the plan was made is caught, and an identical DOI can never be duplicated.
 *  - A human "this is distinct" decision (`confirmDistinct`) is honoured only where the duplicate rules allow an override.
 */

/** The system actor of the guard: it may confirm an overridable warning, exactly like a lab manager (`canOverrideDuplicate`). */
const IMPORT_ACTOR: Actor = { id: "publication-import", role: "LAB_MANAGER" };

export interface ApplyOptions {
  visibility: Visibility;
  fillEmpty: boolean;
  /** Ordinals (as strings) a human confirmed as distinct from the record they resemble. */
  confirmDistinct: ReadonlySet<string>;
}

export type Outcome = "created" | "created-confirmed" | "filled" | "unchanged" | "skipped" | "failed";

export interface ApplyResult {
  ordinal: number;
  outcome: Outcome;
  detail: string;
  id?: string;
}

const FILLABLE = ["doiUrl", "status", "pubMonth", "volume", "pageStart", "pageEnd", "issn", "isbn", "category", "acceptedDate"] as const;

export async function applyPlan(db: PrismaClient, plan: Plan, options: ApplyOptions): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const entry of plan.entries) results.push(await applyEntry(db, entry, options));
  return results;
}

async function applyEntry(db: PrismaClient, entry: PlanEntry, options: ApplyOptions): Promise<ApplyResult> {
  const { candidate } = entry;
  const ordinal = candidate.ordinal;
  const f = candidate.fields;
  try {
    switch (entry.disposition) {
      case "new":
      case "conflict":
      case "possible-match": {
        const confirmed = entry.disposition !== "new" && entry.confirmable && options.confirmDistinct.has(String(ordinal));
        if (entry.disposition !== "new" && !confirmed) return { ordinal, outcome: "skipped", detail: `${entry.disposition}: needs a human decision (see the report)` };
        const created = await db.$transaction(async (tx) => {
          await lockForDuplicateCheck(tx, "publication");
          // Re-checked at write time. For a confirmed record the guard is told so; an identical DOI still cannot be confirmed.
          const overridden = await guardPublication(tx, IMPORT_ACTOR, { next: { title: f.title, year: f.year!, doiUrl: f.doiUrl }, confirm: confirmed });
          const row = await tx.publication.create({
            data: {
              year: f.year!,
              title: f.title,
              authors: f.authors,
              venue: f.venue,
              doiUrl: f.doiUrl,
              status: f.status,
              pubMonth: f.pubMonth,
              volume: f.volume,
              pageStart: f.pageStart,
              pageEnd: f.pageEnd,
              issn: f.issn,
              isbn: f.isbn,
              category: f.category,
              acceptedDate: f.acceptedDate,
              visibility: options.visibility,
            },
          });
          await recordAudit(tx, {
            actor: null,
            action: "PUBLICATION_CREATED",
            entityType: "PUBLICATION",
            entityId: row.id,
            details: {
              title: row.title,
              year: row.year,
              visibility: row.visibility,
              linkedAuthors: 0,
              source: "xlsx-import",
              // A person's decision is recorded whether or not the duplicate guard also fired for it.
              ...(confirmed ? { confirmedDistinct: true } : {}),
              ...(overridden ? { duplicateOverride: overridden } : {}),
            },
          });
          return { row, overridden };
        });
        return { ordinal, outcome: confirmed ? "created-confirmed" : "created", detail: confirmed ? `created after a human confirmed it is distinct${created.overridden ? ` (${created.overridden})` : ""}` : "created", id: created.row.id };
      }
      case "existing-match": {
        if (!options.fillEmpty) return { ordinal, outcome: "unchanged", detail: "already stored; left untouched" };
        const target = entry.matches[0];
        const filled = await db.$transaction(async (tx) => {
          const current = await tx.publication.findUnique({ where: { id: target.id } });
          if (!current) return [] as string[];
          const data: Prisma.PublicationUpdateInput = {};
          const names: string[] = [];
          for (const key of FILLABLE) {
            const have = current[key];
            const want = f[key];
            const isEmpty = have === "" || have === 0;
            const wanted = want !== "" && want !== 0;
            if (isEmpty && wanted) {
              (data as Record<string, unknown>)[key] = want;
              names.push(key);
            }
          }
          if (names.length > 0) {
            await tx.publication.update({ where: { id: current.id }, data });
            await recordAudit(tx, { actor: null, action: "PUBLICATION_UPDATED", entityType: "PUBLICATION", entityId: current.id, details: { title: current.title, changed: names.join(","), source: "xlsx-import" } });
          }
          return names;
        });
        return filled.length > 0
          ? { ordinal, outcome: "filled", detail: `filled empty fields: ${filled.join(", ")}`, id: target.id }
          : { ordinal, outcome: "unchanged", detail: "already stored; nothing empty to fill", id: target.id };
      }
      default:
        return { ordinal, outcome: "skipped", detail: entry.disposition };
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return { ordinal, outcome: "skipped", detail: `the duplicate guard refused it at write time: ${err.message}` };
    // Never echo connection details: only the error class and message of the application / driver.
    return { ordinal, outcome: "failed", detail: err instanceof Error ? err.message.split("\n").slice(-1)[0].slice(0, 300) : "unknown error" };
  }
}

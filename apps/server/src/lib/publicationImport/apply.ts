import type { Prisma, PrismaClient } from "@prisma/client";
import { canonicalDoi, type Actor, type Visibility } from "@scl/shared";
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
 *  - The ONE exception is `applyDecidedUpdates`, off by default and refused by the command unless a review-decisions file is also given: for an
 *    "update-required" entry it replaces exactly the fields a reviewer decided, and only while each stored value is still exactly what the reviewer
 *    saw (compare-and-set), the record still has the same DOI, and the duplicate guard accepts the result. It touches no other field, no author
 *    link, no translation, and writes an audit row naming the fields changed.
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
  /** Carry out the "update-required" entries (review decisions). Off by default: they are then only reported. */
  applyDecidedUpdates?: boolean;
}

export type Outcome = "created" | "created-confirmed" | "filled" | "updated" | "pending-update" | "unchanged" | "skipped" | "failed";

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
      case "confirmed-match":
        return { ordinal, outcome: "unchanged", detail: "a review decision confirms it is a stored publication; not created, stored record untouched", id: entry.matches[0]?.id };
      case "update-required": {
        const target = entry.matches[0];
        if (!options.applyDecidedUpdates) {
          return { ordinal, outcome: "pending-update", detail: `NOT applied (requires an explicit update): ${entry.updates.map((u) => `${u.field} "${u.existing}" -> "${u.incoming}"`).join("; ")}`, id: target.id };
        }
        const result = await db.$transaction(async (tx) => {
          await lockForDuplicateCheck(tx, "publication");
          const current = await tx.publication.findUnique({ where: { id: target.id } });
          if (!current) return { ok: false as const, why: "the stored record no longer exists" };
          if (canonicalDoi(current.doiUrl) !== canonicalDoi(f.doiUrl)) return { ok: false as const, why: "the stored record no longer has this DOI" };
          for (const u of entry.updates) {
            if (String((current as unknown as Record<string, unknown>)[u.field]) !== u.existing) return { ok: false as const, why: `the stored ${u.field} is no longer "${u.existing}" (it changed since the review); nothing was changed` };
          }
          const data: Record<string, string | number> = {};
          for (const u of entry.updates) data[u.field] = u.field === "year" || u.field === "pubMonth" ? Number(u.incoming) : u.incoming;
          // The same duplicate rules as everywhere else, on the record as it WOULD be, excluding the record itself.
          await guardPublication(tx, IMPORT_ACTOR, {
            next: { title: current.title, year: typeof data.year === "number" ? data.year : current.year, doiUrl: current.doiUrl },
            previous: { title: current.title, year: current.year, doiUrl: current.doiUrl },
            excludeId: current.id,
            confirm: false,
          });
          await tx.publication.update({ where: { id: current.id }, data });
          await recordAudit(tx, {
            actor: null,
            action: "PUBLICATION_UPDATED",
            entityType: "PUBLICATION",
            entityId: current.id,
            details: { title: current.title, changed: entry.updates.map((u) => u.field).join(","), source: "xlsx-import-decision" },
          });
          return { ok: true as const };
        });
        return result.ok
          ? { ordinal, outcome: "updated", detail: `updated by review decision: ${entry.updates.map((u) => `${u.field} "${u.existing}" -> "${u.incoming}"`).join("; ")}`, id: target.id }
          : { ordinal, outcome: "skipped", detail: `decided update NOT applied: ${result.why}`, id: target.id };
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

/**
 * Unit checks for the publication metadata in the shared zod schemas: create with and without it, update that keeps what is not sent,
 * clearing, every validation rule, the response shape and the strings. No server, no database, no network.
 *   npm run test:unit -w apps/server
 */
import { createPublicationSchema, en, ja, publicationSchema, updatePublicationSchema } from "@scl/shared";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));

const base = { year: 2023, title: "T", authors: "A", venue: "V" };
const META = { status: "PUBLISHED", listNumber: "1745-1337", category: "REGULAR PAPER", volume: "E-107 A", startPage: 1139, endPage: 1150, month: 11, acceptedDate: "2026-07-15" };
const NOT_STATED = { status: "", listNumber: "", category: "", volume: "", startPage: 0, endPage: 0, month: 0, acceptedDate: "" };
const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(NOT_STATED).map((k) => [k, o[k]]));

// ---- create ---------------------------------------------------------------------------------------------------------------------------
{
  const r = createPublicationSchema.safeParse({ ...base, ...META });
  t("create: all the metadata is accepted and kept as given", r.success && JSON.stringify(pick(r.data)) === JSON.stringify(META), JSON.stringify(r));
  const old = createPublicationSchema.safeParse(base);
  t("create: a request with none of the new fields (an older client) is valid and stores 'not stated'", old.success && JSON.stringify(pick(old.data)) === JSON.stringify(NOT_STATED), JSON.stringify(old));
  const blanks = createPublicationSchema.safeParse({ ...base, status: "", listNumber: "", category: "", volume: "", startPage: "", endPage: "", month: "", acceptedDate: "" });
  t("create: blank boxes (what the form sends) are 'not stated'", blanks.success && JSON.stringify(pick(blanks.data)) === JSON.stringify(NOT_STATED));
  const typed = createPublicationSchema.safeParse({ ...base, startPage: "12", endPage: "20", month: "3" });
  t("create: numbers typed as text become numbers", typed.success && typed.data.startPage === 12 && typed.data.endPage === 20 && typed.data.month === 3);
  const nulls = createPublicationSchema.safeParse({ ...base, startPage: null, endPage: null, month: null });
  t("create: null numbers mean 'not stated'", nulls.success && nulls.data.startPage === 0 && nulls.data.month === 0);
  const trimmed = createPublicationSchema.safeParse({ ...base, volume: "  7(2), 21  ", category: " REGULAR PAPER ", listNumber: " 277 " });
  t("create: text is trimmed, nothing else about it changes", trimmed.success && trimmed.data.volume === "7(2), 21" && trimmed.data.category === "REGULAR PAPER" && trimmed.data.listNumber === "277");
  t("create: the existing fields and rules are unchanged (title, authors, venue and year are still required)", !createPublicationSchema.safeParse({ ...base, title: "" }).success && !createPublicationSchema.safeParse({ ...base, year: undefined }).success && !createPublicationSchema.safeParse({ ...base, venue: "" }).success);
}

// ---- validation -----------------------------------------------------------------------------------------------------------------------
{
  const bad = (extra: Record<string, unknown>) => createPublicationSchema.safeParse({ ...base, ...extra });
  const msg = (extra: Record<string, unknown>) => { const r = bad(extra); return r.success ? "" : r.error.issues[0]?.message ?? ""; };
  t("validation: month must be 1-12", !bad({ month: 13 }).success && !bad({ month: -1 }).success && !bad({ month: 2.5 }).success && !bad({ month: "abc" }).success && bad({ month: 1 }).success && bad({ month: 12 }).success);
  t("validation: the month message names the field and the range", /Month must be between 1 and 12/.test(msg({ month: 13 })), msg({ month: 13 }));
  t("validation: pages are whole numbers from 1 to 99999 (0 / blank = not stated)", !bad({ startPage: -3 }).success && !bad({ startPage: 1.5 }).success && !bad({ endPage: 100000 }).success && bad({ startPage: 1, endPage: 99999 }).success && bad({ startPage: 0 }).success);
  t("validation: a backwards page range is refused with a clear message", !bad({ startPage: 50, endPage: 10 }).success && /Ending page must not be before the starting page/.test(msg({ startPage: 50, endPage: 10 })));
  t("validation: equal pages and a lone page are fine", bad({ startPage: 5, endPage: 5 }).success && bad({ startPage: 7 }).success && bad({ endPage: 11 }).success);
  t("validation: the date of acceptance must be a real YYYY-MM-DD date", !bad({ acceptedDate: "2026-02-30" }).success && !bad({ acceptedDate: "15/07/2026" }).success && !bad({ acceptedDate: "1850-01-01" }).success && bad({ acceptedDate: "2026-07-15" }).success && bad({ acceptedDate: "" }).success);
  t("validation: status is one of the three or blank", !bad({ status: "DONE" }).success && !bad({ status: "published" }).success && bad({ status: "ACCEPTED" }).success && bad({ status: "SUBMITTED" }).success && bad({ status: "" }).success);
  t("validation: volume, category and list number are capped at 100 characters", !bad({ volume: "x".repeat(101) }).success && !bad({ category: "x".repeat(101) }).success && !bad({ listNumber: "x".repeat(101) }).success && bad({ volume: "x".repeat(100) }).success);
  t("validation: non-text where text is expected is refused", !bad({ volume: 5 }).success && !bad({ status: 1 }).success);
}

// ---- update -----------------------------------------------------------------------------------------------------------------------------
{
  const titleOnly = updatePublicationSchema.safeParse({ title: "New" });
  t("update: changing only the title carries NO metadata keys, so nothing stored is overwritten", titleOnly.success && Object.keys(NOT_STATED).every((k) => !(k in (titleOnly.data as object))), JSON.stringify(titleOnly));
  const one = updatePublicationSchema.safeParse({ volume: "9" });
  t("update: changing one metadata field carries only that field", one.success && Object.keys(one.data).join() === "volume");
  t("update: a request that carries only metadata is a real update, not 'Nothing to update.'", updatePublicationSchema.safeParse({ month: 5 }).success && updatePublicationSchema.safeParse({ status: "ACCEPTED" }).success);
  t("update: an empty request is still 'Nothing to update.'", !updatePublicationSchema.safeParse({}).success && !updatePublicationSchema.safeParse({ confirmDuplicate: true }).success);
  const clear = updatePublicationSchema.safeParse({ month: "", startPage: 0, endPage: null, acceptedDate: "", status: "", volume: "" });
  t("update: '', 0 and null clear (stored as 'not stated')", clear.success && clear.data.month === 0 && clear.data.startPage === 0 && clear.data.endPage === 0 && clear.data.acceptedDate === "" && clear.data.status === "" && clear.data.volume === "");
  t("update: the same validation applies", !updatePublicationSchema.safeParse({ month: 13 }).success && !updatePublicationSchema.safeParse({ acceptedDate: "2026-02-30" }).success && !updatePublicationSchema.safeParse({ status: "DONE" }).success);
  t("update: a backwards range inside one request is refused; a single end is left for the route to check against the stored page", !updatePublicationSchema.safeParse({ startPage: 50, endPage: 10 }).success && updatePublicationSchema.safeParse({ endPage: 10 }).success);
  const full = updatePublicationSchema.safeParse({ ...base, ...META });
  t("update: the edit form's full body (every box) is accepted and complete", full.success && JSON.stringify(pick(full.data)) === JSON.stringify(META));
}

// ---- response shape and strings -------------------------------------------------------------------------------------------------------------
{
  const shape = Object.keys(publicationSchema.shape);
  t("response: every metadata field is part of the public publication", Object.keys(NOT_STATED).every((k) => shape.includes(k)));
  t("response: the existing fields are all still there", ["id", "year", "title", "authors", "venue", "pdfUrl", "doiUrl", "extraUrl", "extraLabel", "visibility"].every((k) => shape.includes(k)));
  const E = en as Record<string, string>;
  const J = ja as Record<string, string>;
  const keys = Object.keys(E).filter((k) => /^publications\.meta\./.test(k) || k === "publications.form.groupMetadata" || k === "publications.form.metadataHint");
  const expected = ["publications.form.groupMetadata", "publications.form.metadataHint", "publications.meta.heading", "publications.meta.status", "publications.meta.statusNone", "publications.meta.status.PUBLISHED", "publications.meta.status.ACCEPTED", "publications.meta.status.SUBMITTED", "publications.meta.category", "publications.meta.listNumber", "publications.meta.volume", "publications.meta.pages", "publications.meta.startPage", "publications.meta.endPage", "publications.meta.month", "publications.meta.monthPlaceholder", "publications.meta.acceptedDate"];
  t("strings: exactly the expected metadata keys exist (legend, hint, labels, the three statuses)", JSON.stringify([...keys].sort()) === JSON.stringify([...expected].sort()), keys.filter((k) => !expected.includes(k)).concat(expected.filter((k) => !keys.includes(k))).join());
  t("strings: every one exists in Japanese too, and is translated (not a copy of the English)", keys.every((k) => typeof J[k] === "string" && J[k].length > 0 && J[k] !== E[k]), keys.filter((k) => !J[k] || J[k] === E[k]).join());
  t("strings: the legend is 'Publication Metadata'", E["publications.form.groupMetadata"] === "Publication Metadata");
}

if (failures.length > 0) {
  console.error(`FAILED ${failures.length} of ${ok + failures.length}:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`publication metadata (schema): ${ok} checks passed`);

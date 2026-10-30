/**
 * Unit checks for the publication metadata rules that need no schema library: the pure validators (packages/shared publicationMetadata.ts)
 * and the display logic (apps/web/src/lib/publicationMeta.ts): which metadata is shown, and that nothing "not stated" produces a label.
 * The zod schemas are checked in unit-publication-metadata-schema.test.ts. No server, no database, no network.
 *   npm run test:unit -w apps/server
 */
import {
  MAX_PUBLICATION_PAGE,
  PUBLICATION_STATUSES,
  isIsoDate,
  isPublicationStatus,
  pageRangeProblem,
} from "../../../packages/shared/src/schemas/publicationMetadata.ts";
import { metaEntries, numberToField, type PublicationMetaSource } from "../../web/src/lib/publicationMeta.ts";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));

// ---- status ------------------------------------------------------------------------------------------------------------------------------
t("statuses are exactly the workbook's three: published, accepted, under submission", PUBLICATION_STATUSES.join() === "PUBLISHED,ACCEPTED,SUBMITTED");
t("isPublicationStatus accepts the three and nothing else (not '', not lower-case, not a prototype key)", PUBLICATION_STATUSES.every(isPublicationStatus) && !isPublicationStatus("") && !isPublicationStatus("published") && !isPublicationStatus("DONE") && !isPublicationStatus("constructor"));

// ---- dates ------------------------------------------------------------------------------------------------------------------------------
t("isIsoDate: real dates", isIsoDate("2026-07-15") && isIsoDate("2024-02-29") && isIsoDate("1900-01-01") && isIsoDate("2100-12-31"));
t("isIsoDate: impossible dates", !isIsoDate("2026-02-30") && !isIsoDate("2025-02-29") && !isIsoDate("2026-13-01") && !isIsoDate("2026-00-10") && !isIsoDate("2026-04-31"));
t("isIsoDate: wrong shapes", !isIsoDate("") && !isIsoDate("15/07/2026") && !isIsoDate("2026-7-5") && !isIsoDate("2026-07-15T00:00:00Z") && !isIsoDate("15-Jul-26") && !isIsoDate(" 2026-07-15"));
t("isIsoDate: years outside 1900-2100", !isIsoDate("1899-12-31") && !isIsoDate("2101-01-01"));

// ---- page range -------------------------------------------------------------------------------------------------------------------------
t("pageRangeProblem: a forward range, equal pages, a lone page and no pages are fine", pageRangeProblem(1139, 1150) === null && pageRangeProblem(5, 5) === null && pageRangeProblem(7, 0) === null && pageRangeProblem(0, 11) === null && pageRangeProblem(0, 0) === null);
t("pageRangeProblem: a backwards range is a problem with a clear message", pageRangeProblem(20, 10) === "Ending page must not be before the starting page.");
t("MAX_PUBLICATION_PAGE is a sane bound", MAX_PUBLICATION_PAGE === 99999);

// ---- what is shown ----------------------------------------------------------------------------------------------------------------------
const none: PublicationMetaSource = { status: "", category: "", listNumber: "", volume: "", startPage: 0, endPage: 0, month: 0, acceptedDate: "" };
const keys = (p: Partial<PublicationMetaSource>) => metaEntries({ ...none, ...p }).map((e) => e.key).join();
t("display: a publication with no metadata (every existing record) shows nothing, so no empty label", metaEntries(none).length === 0);
t("display: each stated value produces its own entry, in a fixed order", keys({ status: "PUBLISHED", category: "REGULAR PAPER", listNumber: "1745-1337", volume: "E-107 A", startPage: 1139, endPage: 1150, month: 11, acceptedDate: "2026-07-15" }) === "status,category,listNumber,volume,pages,month,acceptedDate");
t("display: the values are the stored ones, untouched", (() => {
  const m = Object.fromEntries(metaEntries({ ...none, category: "REGULAR PAPER 2023EAP1115", volume: "7(2), 21", listNumber: "277", startPage: 1139, endPage: 1150, month: 11, acceptedDate: "2026-07-15" }).map((e) => [e.key, e.value]));
  return m.category === "REGULAR PAPER 2023EAP1115" && m.volume === "7(2), 21" && m.listNumber === "277" && m.pages === "1139–1150" && m.month === "11" && m.acceptedDate === "2026-07-15";
})());
t("display: only a start page, or only an end page, keeps its own honest label (not a range)", keys({ startPage: 7 }) === "startPage" && keys({ endPage: 11 }) === "endPage");
t("display: an unknown or stray status is not shown", keys({ status: "DONE" }) === "" && keys({ status: "constructor" }) === "");
t("display: a month outside 1-12 is not shown", keys({ month: 13 }) === "" && keys({ month: -1 }) === "" && keys({ month: 12 }) === "month");
t("display: whitespace-only text still counts as stated text only if non-empty (the API trims, so '' is the only blank)", keys({ volume: "" }) === "" && keys({ volume: "0" }) === "volume");
t("numberToField: 0 is an empty box, a real number is its text", numberToField(0) === "" && numberToField(1139) === "1139" && numberToField(12) === "12");

if (failures.length > 0) {
  console.error(`FAILED ${failures.length} of ${ok + failures.length}:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`publication metadata (pure): ${ok} checks passed`);

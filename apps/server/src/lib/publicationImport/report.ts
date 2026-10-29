import type { ApplyResult } from "./apply.js";
import type { Candidate } from "./map.js";
import type { Plan, PlanEntry } from "./plan.js";
import type { ParsedSheets } from "./sheet.js";

/**
 * The human-readable account of an import: what the spreadsheet holds, how each source field maps, what will happen to every record and
 * what a person must still decide. It contains bibliographic data only: no credentials, no connection string (the target is shown by its
 * host or file name), no database ids except those of EXISTING records a person needs in order to resolve a conflict.
 */

export interface FieldMapRow {
  source: string;
  cells: string;
  destination: string;
  note: string;
}

/** The source -> destination mapping. Documented in docs/architecture/publication-list-import.md; a test keeps the two in step. */
export const FIELD_MAP: readonly FieldMapRow[] = [
  { source: "著者 Authors", cells: "C (row 'Authors')", destination: "Publication.authors", note: "Order and names kept; only spacing around commas, a trailing comma and line breaks are normalised." },
  { source: "題目 Title", cells: "C", destination: "Publication.title", note: "Kept as written (line breaks become spaces). A '(Accepted)' note inside the title is kept and flagged." },
  { source: "雑誌名 Journal / conference", cells: "C", destination: "Publication.venue", note: "Kept as written (trailing comma removed). An ISSN in this cell is flagged." },
  { source: "雑誌リスト番号 Journal list number", cells: "C", destination: "Publication.issn or Publication.isbn", note: "ISSN pattern -> issn; ISBN pattern -> isbn; anything else is reported as unresolved (no field)." },
  { source: "論文カテゴリー Category", cells: "C", destination: "Publication.category", note: "Stored as written (it may include a manuscript number)." },
  { source: "巻 Volume", cells: "C", destination: "Publication.volume", note: "Stored as written (it may include issue / article number, e.g. '7(3), 53'). Not split." },
  { source: "ページ Pages: 始め Start", cells: "D", destination: "Publication.pageStart", note: "As written." },
  { source: "ページ Pages: 終り End", cells: "F", destination: "Publication.pageEnd", note: "As written." },
  { source: "DOI", cells: "C", destination: "Publication.doiUrl", note: "A DOI link is kept as written; a bare DOI becomes https://doi.org/<doi>; anything else is reported as unresolved." },
  { source: "発行年月 Issue date: 年 Year", cells: "D", destination: "Publication.year", note: "Required. If absent, the year of a stated acceptance date is used (reported); otherwise the record is blocked until a person supplies it." },
  { source: "発行年月 Issue date: 月 Month", cells: "F", destination: "Publication.pubMonth", note: "1-12; anything else is reported and left as 'not stated' (0)." },
  { source: "状況 Status", cells: "C", destination: "Publication.status", note: "出版 -> PUBLISHED, 受理 -> ACCEPTED, 投稿中 -> SUBMITTED; empty -> not stated. Never inferred." },
  { source: "受理年月日 Date of acceptance", cells: "H", destination: "Publication.acceptedDate", note: "Date cell, YYYY年MM月DD日 or d-Mon-yy text -> ISO date. The unfilled template '年 月 日' means none." },
  { source: "Record label (A column)", cells: "A", destination: "(report key only)", note: "Used for the record's ordinal in reports; not stored." },
  { source: "氏名 Name (top of sheet)", cells: "C3", destination: "(not stored)", note: "Whose list this is. The import never links publications to team members or accounts." },
];

export interface ImportSummary {
  file: string;
  target: string;
  mode: "dry-run" | "apply";
  owner: string;
  sheets: ParsedSheets["sheets"];
  sourceRecords: number;
  emptyBlocks: number;
  counts: Plan["counts"];
  applied?: Record<string, number>;
}

const cut = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function statusLabel(c: Candidate): string {
  return c.fields.status || "(not stated)";
}

export function buildJsonReport(summary: ImportSummary, plan: Plan, results?: ApplyResult[]) {
  return {
    summary,
    fieldMap: FIELD_MAP,
    records: plan.entries.map((e) => ({
      ordinal: e.candidate.ordinal,
      label: e.candidate.label,
      rows: e.candidate.rows,
      disposition: e.disposition,
      reasons: e.reasons,
      fields: e.candidate.fields,
      sources: e.candidate.sources,
      normalizations: e.candidate.normalizations,
      warnings: e.candidate.warnings,
      errors: e.candidate.errors,
      unresolved: e.candidate.unresolved,
      overridden: e.candidate.overridden,
      matches: e.matches,
      diffs: e.diffs,
      confirmable: e.confirmable,
    })),
    results: results ?? [],
  };
}

export function buildMarkdownReport(summary: ImportSummary, plan: Plan, results?: ApplyResult[]): string {
  const L: string[] = [];
  const c = summary.counts;
  L.push(`# Publication list import report (${summary.mode})`, "");
  L.push(`- Source file: \`${summary.file}\``);
  L.push(`- Target database: \`${summary.target}\``);
  L.push(`- List owner stated in the file: ${summary.owner || "(none)"}`);
  L.push(`- Worksheets: ${summary.sheets.map((s) => `${s.name} (${s.state}, ${s.cellCount} cells, ${s.blocks} record blocks${s.skipped ? `, ${s.skipped}` : ""})`).join("; ")}`);
  L.push("", "## Counts", "");
  L.push("| | |", "|---|---|");
  L.push(`| Publication records found in the source | ${summary.sourceRecords} |`, `| Blank template blocks (not records) | ${summary.emptyBlocks} |`);
  L.push(`| New (will be / was created) | ${c.new} |`, `| Already stored, identical (existing match) | ${c["existing-match"]} |`);
  L.push(`| Conflicts with an existing record (human decision) | ${c.conflict} |`, `| Possible matches (human decision) | ${c["possible-match"]} |`);
  L.push(`| Duplicates inside the file | ${c["duplicate-in-source"]} |`, `| Invalid / incomplete (blocked) | ${c.invalid} |`);
  if (summary.applied) L.push("", "Applied: " + Object.entries(summary.applied).map(([k, v]) => `${k} ${v}`).join(", "));

  L.push("", "## Records", "", "| # | Source label | Year | Status | Title | Disposition | Notes |", "|---|---|---|---|---|---|---|");
  for (const e of plan.entries) {
    const f = e.candidate.fields;
    const notes = [...e.candidate.errors.map((x) => `ERROR ${x.code}`), ...e.candidate.warnings.map((w) => w.code)].join(", ");
    L.push(`| ${e.candidate.ordinal} | ${esc(cut(e.candidate.label, 24))} | ${f.year ?? "—"}${f.pubMonth ? `-${String(f.pubMonth).padStart(2, "0")}` : ""} | ${statusLabel(e.candidate)} | ${esc(cut(f.title))} | ${e.disposition} | ${esc(notes)} |`);
  }

  const section = (title: string, entries: PlanEntry[], body: (e: PlanEntry) => string[]) => {
    if (entries.length === 0) return;
    L.push("", `## ${title}`, "");
    for (const e of entries) L.push(...body(e), "");
  };
  section("Blocked: needs information a person must supply", plan.entries.filter((e) => e.disposition === "invalid"), (e) => [
    `### Record ${e.candidate.ordinal} — ${cut(e.candidate.fields.title || "(no title)", 100)}`,
    ...e.candidate.errors.map((x) => `- **${x.code}**${x.cell ? ` (${x.cell})` : ""}: ${x.message}`),
  ]);
  section("Conflicts and possible matches: a human decides, nothing was overwritten", plan.entries.filter((e) => e.disposition === "conflict" || e.disposition === "possible-match"), (e) => [
    `### Record ${e.candidate.ordinal} — ${cut(e.candidate.fields.title, 100)}`,
    ...e.reasons.map((r) => `- ${r}`),
    ...e.matches.map((m) => `- Existing record \`${m.id}\` (matched by ${m.via}): "${cut(m.title, 100)}" (${m.year})`),
    ...e.diffs.map((d) => `  - differs in **${d.field}**: existing "${cut(d.existing, 80)}" vs file "${cut(d.incoming, 80)}"`),
    e.confirmable ? "- If it really is a different publication, list its number in `confirmDistinct` of the overrides file. If it is the same, do nothing: the existing record stays." : "- An identical DOI cannot be confirmed as distinct. Fix the existing record in the admin interface if the file is the correct one.",
  ]);

  const flagged = plan.entries.filter((e) => e.candidate.warnings.length > 0 || e.candidate.normalizations.length > 0 || e.candidate.unresolved.length > 0);
  section("Warnings, normalisations and unresolved values (per record)", flagged, (e) => [
    `### Record ${e.candidate.ordinal} — ${cut(e.candidate.fields.title, 100)}`,
    ...e.candidate.warnings.map((w) => `- warning **${w.code}**${w.cell ? ` (${w.cell})` : ""}: ${w.message}`),
    ...e.candidate.normalizations.map((n) => `- normalised: ${n}`),
    ...e.candidate.unresolved.map((u) => `- UNRESOLVED ${u.field} (${u.cell}): "${cut(u.value, 80)}" — ${u.reason}`),
    ...(e.candidate.overridden.length ? [`- human override applied to: ${e.candidate.overridden.join(", ")}`] : []),
  ]);

  const blocked = plan.entries.filter((e) => e.disposition === "invalid" && e.candidate.errors.some((x) => x.code === "no-year"));
  if (blocked.length > 0) {
    const template: Record<string, unknown> = {};
    for (const e of blocked) template[String(e.candidate.ordinal)] = { expectTitle: e.candidate.fields.title.slice(0, 30), year: "FILL IN AFTER CHECKING THE SOURCE" };
    L.push("## Overrides file template for the blocked records", "", "```json", JSON.stringify({ records: template, confirmDistinct: [] }, null, 2), "```", "");
  }

  if (results && results.length > 0) {
    L.push("## Apply results", "", "| # | Outcome | Detail |", "|---|---|---|");
    for (const r of results) L.push(`| ${r.ordinal} | ${r.outcome} | ${esc(r.detail)} |`);
    L.push("");
  }

  L.push("## Source field mapping", "", "| Source field | Cells | Destination | Note |", "|---|---|---|---|");
  for (const m of FIELD_MAP) L.push(`| ${esc(m.source)} | ${m.cells} | ${m.destination} | ${esc(m.note)} |`);
  L.push("");
  return L.join("\n");
}

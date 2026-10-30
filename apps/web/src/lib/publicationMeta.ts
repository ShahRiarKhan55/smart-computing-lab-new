/**
 * Which of a publication's optional metadata is actually stated, as raw values (no wording, no formatting): the display components turn these
 * into translated labels. A value that is "not stated" ("" or 0) never produces an entry, so no empty label is ever shown.
 */
export interface PublicationMetaSource {
  status: string;
  category: string;
  listNumber: string;
  volume: string;
  startPage: number;
  endPage: number;
  month: number;
  acceptedDate: string;
}

export type MetaKey = "status" | "category" | "listNumber" | "volume" | "pages" | "startPage" | "endPage" | "month" | "acceptedDate";

export interface MetaEntry {
  key: MetaKey;
  /** The stored value as text; for "pages" the range "start–end". */
  value: string;
}

const KNOWN_STATUS = new Set(["PUBLISHED", "ACCEPTED", "SUBMITTED"]);

export function metaEntries(p: PublicationMetaSource): MetaEntry[] {
  const out: MetaEntry[] = [];
  if (KNOWN_STATUS.has(p.status)) out.push({ key: "status", value: p.status });
  if (p.category) out.push({ key: "category", value: p.category });
  if (p.listNumber) out.push({ key: "listNumber", value: p.listNumber });
  if (p.volume) out.push({ key: "volume", value: p.volume });
  // A range only when both ends are stated; a single stated end keeps its own honest label.
  if (p.startPage > 0 && p.endPage > 0) out.push({ key: "pages", value: `${p.startPage}–${p.endPage}` });
  else if (p.startPage > 0) out.push({ key: "startPage", value: String(p.startPage) });
  else if (p.endPage > 0) out.push({ key: "endPage", value: String(p.endPage) });
  if (p.month >= 1 && p.month <= 12) out.push({ key: "month", value: String(p.month) });
  if (p.acceptedDate) out.push({ key: "acceptedDate", value: p.acceptedDate });
  return out;
}

/** The form shows a stored 0 as an empty box. */
export const numberToField = (n: number): string => (n > 0 ? String(n) : "");

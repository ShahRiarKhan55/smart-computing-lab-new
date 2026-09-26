/**
 * Unit test of the pure parts of Phase 20 discovery: the `related` result shape and the EN/JA
 * dictionaries for the new keys. No server, no database.
 */
import { SEARCH_RELATED_MAX, en, ja, searchResultSchema, searchResponseSchema, SEARCH_FILTERS, SEARCH_TYPES } from "@scl/shared";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

const base = { type: "publication", id: "p1", title: "T", description: "", meta: "", href: "/publications/p1" };
const rel = { type: "project", id: "x1", title: "P", href: "/projects/x1" };

t("SEARCH_RELATED_MAX is 3", SEARCH_RELATED_MAX === 3);
t("a result without `related` still parses (older/other types)", searchResultSchema.safeParse(base).success);
t("a result with a related project parses", searchResultSchema.safeParse({ ...base, related: [rel] }).success);
t("related accepts area, project and group only", ["research-area", "project", "group"].every((type) => searchResultSchema.safeParse({ ...base, related: [{ ...rel, type }] }).success));
t("related rejects other entity types (researcher, forum-topic, message)", ["researcher", "forum-topic", "message", "publication"].every((type) => !searchResultSchema.safeParse({ ...base, related: [{ ...rel, type }] }).success));
t("related rejects a missing href", !searchResultSchema.safeParse({ ...base, related: [{ type: "project", id: "x", title: "P" }] }).success);
t("the response schema embeds the same result shape", searchResponseSchema.safeParse({ query: "q", type: "all", results: [{ ...base, related: [rel] }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }, counts: Object.fromEntries(SEARCH_FILTERS.map((f) => [f, 0])) }).success);
t("search types are the nine documented ones (Phase 22 added knowledge), no private ones", SEARCH_TYPES.length === 9 && !SEARCH_TYPES.some((s) => /message|notification/.test(s)));

const keys = Object.keys(en).filter((k) => /^(explore\.|search\.related|search\.other|projects\.filter\.|research\.explore\.)/.test(k));
t("the Phase 20 keys exist", keys.length >= 30);
t("every Phase 20 key has a non-empty Japanese value that differs from English", keys.every((k) => (ja as Record<string, string>)[k] && (ja as Record<string, string>)[k] !== (en as Record<string, string>)[k]));
const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
t("placeholders match between EN and JA for every Phase 20 key", keys.every((k) => ph((en as Record<string, string>)[k]) === ph((ja as Record<string, string>)[k])));

console.log(`${ok} discovery unit checks passed, ${failures.length} failed.`);
for (const f of failures) console.log("  FAIL", f);
process.exit(failures.length ? 1 : 0);

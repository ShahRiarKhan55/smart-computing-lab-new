/**
 * Unit test of the pure parts of global search: the query parser, the request schema and the
 * excerpt cutter. No server, no database.   npm run test:unit -w apps/server
 */
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_FILTERS,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_PAGE,
  SEARCH_MAX_TERMS,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_TYPES,
  parseSearchText,
  searchQuerySchema,
} from "@scl/shared";
import { excerpt } from "../src/lib/search.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- parseSearchText -------------------------------------------------------------
const p = parseSearchText;
t("plain word", same(p("FPGA"), { phrase: "FPGA", terms: ["FPGA"] }));
t("two words keep their order in the phrase", same(p("FPGA aging"), { phrase: "FPGA aging", terms: ["FPGA", "aging"] }));
t("runs of whitespace collapse", same(p("  FPGA \t\n  aging  ").phrase, "FPGA aging"));
t("Japanese without spaces is ONE word (substring match)", same(p("半導体"), { phrase: "半導体", terms: ["半導体"] }));
t("mixed English/Japanese splits on the space only", same(p("FPGA エージング").terms, ["FPGA", "エージング"]));
t("ideographic space U+3000 separates words", same(p("FPGA　エージング").terms, ["FPGA", "エージング"]));
t("NFKC: full-width Latin becomes ASCII", same(p("ＦＰＧＡ　ａｇｉｎｇ"), { phrase: "FPGA aging", terms: ["FPGA", "aging"] }));
t("NFKC: half-width katakana becomes full-width", same(p("ﾃﾞｰﾀ").terms, ["データ"]));
t("% and _ are separators (they would be LIKE wildcards)", same(p("a%b_c").terms, ["a", "b", "c"]));
t("only wildcards leaves no words", same(p("%_%_"), { phrase: "", terms: [] }));
t("control characters (NUL, ESC, BEL) are separators", same(p("a\u0000b\u001bc\u0007d").terms, ["a", "b", "c", "d"]));
t("duplicates are dropped case-insensitively, first spelling wins", same(p("FPGA fpga Fpga").terms, ["FPGA"]));
t("...but the phrase keeps what was typed", same(p("FPGA fpga").phrase, "FPGA fpga"));
t("quotes, backslash, SQL text and HTML stay LITERAL inside words", same(p(`O'Brien "x" \\ ; -- <b>`).terms, ["O'Brien", '"x"', "\\", ";", "--", "<b>"]));
t("emoji survive", same(p("🔬 lab").terms, ["🔬", "lab"]));
t("empty string", same(p(""), { phrase: "", terms: [] }));

// ---- searchQuerySchema -----------------------------------------------------------
const s = (o: unknown) => searchQuerySchema.safeParse(o);
const msg = (o: unknown) => {
  const r = s(o);
  return r.success ? null : r.error.issues[0].message;
};
const good = s({ q: "  FPGA  aging " });
t("valid query parses", good.success);
t("defaults: type all, page 1, limit 20", good.success && good.data.type === "all" && good.data.page === 1 && good.data.limit === SEARCH_DEFAULT_LIMIT);
t("q is trimmed; phrase and terms are attached", good.success && good.data.q === "FPGA  aging" && good.data.phrase === "FPGA aging" && good.data.terms.length === 2);
t("page/limit strings become numbers", (() => { const r = s({ q: "a", page: "3", limit: "50" }); return r.success && r.data.page === 3 && r.data.limit === 50; })());
t("every documented type is accepted", SEARCH_FILTERS.every((f) => s({ q: "a", type: f }).success));
t("SEARCH_FILTERS is 'all' + the eight types (Phase 16 added 'event')", SEARCH_FILTERS.length === SEARCH_TYPES.length + 1 && SEARCH_TYPES.length === 8);
t("missing q", msg({}) === "Search text is required.");
t("empty and blank q", msg({ q: "" }) === "Search text is required." && msg({ q: "   " }) === "Search text is required.");
t("q must be text (array / object / number)", msg({ q: ["a"] }) === "Search text must be text." && msg({ q: { a: 1 } }) === "Search text must be text." && msg({ q: 5 }) === "Search text must be text.");
t("max length is enforced on the trimmed text", s({ q: "a".repeat(SEARCH_QUERY_MAX_LENGTH) }).success && !s({ q: "a".repeat(SEARCH_QUERY_MAX_LENGTH + 1) }).success && s({ q: " " + "a".repeat(SEARCH_QUERY_MAX_LENGTH) + " " }).success);
t("wildcard-only text is rejected", msg({ q: "%" }) === "Search text must contain letters or numbers." && msg({ q: "_%_" }) === "Search text must contain letters or numbers.");
t("word count cap", s({ q: "a b c d e f g h" }).success && !s({ q: "a b c d e f g h i" }).success && SEARCH_MAX_TERMS === 8);
t("identical words count once toward the cap", s({ q: "a a a a a a a a a a a a" }).success);
t("unknown type", msg({ q: "a", type: "events" })?.startsWith("Type must be one of") === true && !s({ q: "a", type: "PROJECT" }).success && !s({ q: "a", type: "" }).success && !s({ q: "a", type: ["all"] }).success);
for (const bad of ["0", "-1", "1.5", "abc", "", " 1", "1 ", "+1", "1e3", "0x10", "99999999999", String(SEARCH_MAX_PAGE + 1), "٣"]) t(`page ${JSON.stringify(bad)} rejected`, !s({ q: "a", page: bad }).success);
for (const bad of ["0", "-1", "2.5", "abc", "", String(SEARCH_MAX_LIMIT + 1), "1000000", "99999999999"]) t(`limit ${JSON.stringify(bad)} rejected`, !s({ q: "a", limit: bad }).success);
t("page and limit bounds are inclusive", s({ q: "a", page: "1" }).success && s({ q: "a", page: String(SEARCH_MAX_PAGE) }).success && s({ q: "a", limit: "1" }).success && s({ q: "a", limit: String(SEARCH_MAX_LIMIT) }).success);
t("page/limit as arrays or numbers are rejected", !s({ q: "a", page: ["1"] }).success && !s({ q: "a", page: 1 }).success && !s({ q: "a", limit: [5, 6] }).success);
t("unknown keys (role, visibility, userId) are dropped from the parsed value", (() => { const r = s({ q: "a", role: "ADMIN", visibility: "LAB_ONLY", userId: "x" }); return r.success && !("role" in r.data) && !("visibility" in r.data) && !("userId" in r.data); })());
t("limits are what the docs say (100 chars, 20 default, 50 max)", SEARCH_QUERY_MAX_LENGTH === 100 && SEARCH_DEFAULT_LIMIT === 20 && SEARCH_MAX_LIMIT === 50);

// ---- excerpt ------------------------------------------------------------------------
t("short text is returned whole (whitespace collapsed)", excerpt("a  b\n c", ["b"]) === "a b c");
t("empty text", excerpt("", ["a"]) === "");
const long = "x".repeat(300) + " NEEDLE " + "y".repeat(300);
const cut = excerpt(long, ["needle"]);
t("long text is cut to about 200 chars, around the first match", cut.length <= 202 && cut.includes("NEEDLE") && cut.startsWith("…") && cut.endsWith("…"));
t("a match near the start keeps the start (no leading ellipsis)", (() => { const e = excerpt("NEEDLE " + "z".repeat(400), ["needle"]); return !e.startsWith("…") && e.endsWith("…") && e.length <= 201; })());
t("no match at all: the beginning of the text", excerpt("a".repeat(500), ["zzz"]) === "a".repeat(200) + "…");
t("the EARLIEST of several words is used", excerpt("q".repeat(300) + " ALPHA " + "q".repeat(80) + " BETA " + "q".repeat(300), ["beta", "alpha"]).includes("ALPHA"));
t("Japanese text is cut on characters", (() => { const e = excerpt("あ".repeat(300) + "検索語" + "い".repeat(300), ["検索語"]); return e.includes("検索語") && e.length <= 202; })());
t("a match at the very end: trailing part has no ellipsis", (() => { const e = excerpt("q".repeat(400) + " NEEDLE", ["needle"]); return e.endsWith("NEEDLE") && e.startsWith("…"); })());
t("output is plain text: markup is not interpreted or altered", excerpt("<script>alert(1)</script>", ["script"]) === "<script>alert(1)</script>");

console.log(`${ok} search unit checks passed, ${failures.length} failed.`);
for (const f of failures) console.log("  FAIL", f);
process.exit(failures.length ? 1 : 0);

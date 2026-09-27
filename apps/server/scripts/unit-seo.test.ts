/**
 * Unit test of the Phase 24 SEO helper. Pure function only: no server, no database, no DOM
 * (the DOM-writing half lives in apps/web/src/hooks/useSeo.ts and is covered by the browser
 * regression's ONLY_SHOWCASE section instead).   npm run test:unit -w apps/server
 */
import { truncateForMeta } from "@scl/shared";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

// ---- collapsing / trimming --------------------------------------------------------------------
t("short text is returned unchanged", truncateForMeta("Hello world") === "Hello world");
t("leading/trailing whitespace is trimmed", truncateForMeta("  Hello world  ") === "Hello world");
t("internal newlines/tabs/runs of spaces collapse to one space", truncateForMeta("Hello\n\tworld   again") === "Hello world again");
t("empty string stays empty", truncateForMeta("") === "");
t("whitespace-only string becomes empty", truncateForMeta("   \n\t  ") === "");

// ---- truncation --------------------------------------------------------------------------------
const long = "word ".repeat(60).trim(); // 60 * 5 - 1 = 299 chars, well over the 160 default
const short = truncateForMeta(long);
t("truncated result is at most max+1 chars (content + one ellipsis char)", short.length <= 161);
t("truncated result ends with an ellipsis", short.endsWith("…"));
t("truncation cuts on a word boundary, never mid-word", !short.slice(0, -1).endsWith("wor"));

const exactly160 = "a".repeat(160);
t("text exactly at the limit is not truncated", truncateForMeta(exactly160) === exactly160);
const oneOver = "a".repeat(161);
t("text one character over the limit IS truncated", truncateForMeta(oneOver) !== oneOver);

// A single very long "word" with no spaces at all must still be cut (never returned untruncated),
// even though there is no word boundary to break on.
const noSpaces = "a".repeat(500);
const noSpacesResult = truncateForMeta(noSpaces);
t("a single unbroken long word is still cut down to size", noSpacesResult.length < noSpaces.length);
t("a single unbroken long word still ends with an ellipsis", noSpacesResult.endsWith("…"));

// A custom max is honoured.
t("a custom max is respected", truncateForMeta("one two three four five", 10).length <= 11);

// ---- hostile content: this is pure text handling, so hostile strings must survive unexecuted,
// unmodified apart from the same whitespace/length rules as anything else — never stripped,
// escaped or specially handled, because the caller (useSeo) only ever puts this into a `content`
// attribute or a JSON-LD script's `.text`, neither of which parses it as markup. -------------------
const hostile = '<script>alert(1)</script><img src=x onerror=alert(1)> "quoted" javascript:alert(1)';
const cleanedHostile = truncateForMeta(hostile, 500);
t("hostile markup passes through as plain text, untouched (no HTML stripping/escaping)", cleanedHostile === hostile);

console.log(`\n${ok} unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

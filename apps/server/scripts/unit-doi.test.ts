/**
 * Unit checks for DOI normalization (Phase 27 / P27.7) and its use in the publication schemas.
 *
 *   npm run test:unit -w apps/server
 */
import { DOI_INVALID_MESSAGE, createPublicationSchema, doiFromUrl, doiKey, doiToUrl, normalizeDoi, updatePublicationSchema } from "@scl/shared";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));
const eq = (name: string, got: unknown, want: unknown) => t(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---- accepted shapes ---------------------------------------------------------------------------
eq("bare DOI", normalizeDoi("10.1234/example"), "10.1234/example");
eq("surrounding whitespace is trimmed", normalizeDoi("  \t10.1234/example \n"), "10.1234/example");
eq("https://doi.org/ prefix is removed", normalizeDoi("https://doi.org/10.1234/example"), "10.1234/example");
eq("http:// and dx.doi.org prefix", normalizeDoi("http://dx.doi.org/10.1234/example"), "10.1234/example");
eq("prefix is matched case-insensitively", normalizeDoi("HTTPS://DOI.ORG/10.1234/Example"), "10.1234/Example");
eq("scheme-less doi.org/ prefix", normalizeDoi("doi.org/10.1234/example"), "10.1234/example");
eq("'doi:' label", normalizeDoi("doi:10.1234/example"), "10.1234/example");
eq("'DOI: ' label with a space", normalizeDoi("DOI: 10.1234/example"), "10.1234/example");
eq("a DOUBLED prefix collapses to one", normalizeDoi("https://doi.org/https://doi.org/10.1234/example"), "10.1234/example");
eq("a label then a link also collapses", normalizeDoi("doi:https://doi.org/10.1234/example"), "10.1234/example");
eq("mixed case in the suffix is preserved", normalizeDoi("10.48550/arXiv.2506.03556"), "10.48550/arXiv.2506.03556");
eq("an already-normalized value is unchanged (idempotent)", normalizeDoi(normalizeDoi("https://doi.org/10.1234/example")!), "10.1234/example");
eq("suffix may contain parentheses, angle brackets, semicolons", normalizeDoi("10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-O"), "10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-O");
eq("suffix may contain several slashes", normalizeDoi("10.1000/abc/def/ghi"), "10.1000/abc/def/ghi");
t("short and dotted registrant codes are valid (10.0/zz, 10.1234.5/x)", normalizeDoi("10.0/zz") === "10.0/zz" && normalizeDoi("10.1234.5/x") === "10.1234.5/x");
eq("a resolver link's query string and fragment are dropped", normalizeDoi("https://doi.org/10.1234/example?utm_source=x#top"), "10.1234/example");
eq("a resolver link's percent-encoding is decoded once", normalizeDoi("https://doi.org/10.1000%2Fabc"), "10.1000/abc");

// ---- rejected input --------------------------------------------------------------------------------
for (const [name, bad] of [
  ["empty", ""],
  ["only whitespace", "   "],
  ["not a DOI at all", "hello world"],
  ["missing the suffix", "10.1234/"],
  ["missing the slash", "10.1234"],
  ["wrong directory indicator", "11.1234/example"],
  ["an arbitrary URL", "https://example.com/10.1234/example"],
  ["a look-alike host", "https://notdoi.org/10.1234/example"],
  ["a look-alike host that CONTAINS doi.org", "https://doi.org.evil.test/10.1234/example"],
  ["a javascript: URL", "javascript:alert(1)"],
  ["whitespace inside", "10.1234/exa mple"],
  ["a control character", "10.1234/exa\u0000mple"],
  ["a bad percent escape in a link", "https://doi.org/10.1000%2"],
] as const) {
  eq(`rejects: ${name}`, normalizeDoi(bad), null);
}
eq("rejects a non-string (number)", normalizeDoi(1234 as unknown), null);
eq("rejects null/undefined", normalizeDoi(null) === null && normalizeDoi(undefined) === null, true);
eq("rejects an over-long value", normalizeDoi(`10.1234/${"a".repeat(3000)}`), null);

// ---- links and comparison keys ---------------------------------------------------------------------
eq("doiToUrl builds the canonical link", doiToUrl("10.1234/example"), "https://doi.org/10.1234/example");
eq("doiToUrl keeps '/' separators but encodes a reserved character", doiToUrl("10.1000/a#b?c"), "https://doi.org/10.1000/a%23b%3Fc");
eq("doiToUrl never doubles the prefix when fed a normalized value", doiToUrl(normalizeDoi("https://doi.org/10.1234/example")!), "https://doi.org/10.1234/example");
eq("a link built then re-parsed returns the same DOI (round trip)", doiFromUrl(doiToUrl("10.1000/a#b?c")), "10.1000/a#b?c");
eq("doiFromUrl of a non-DOI link is null", doiFromUrl("https://www.mdpi.com/3921658"), null);
eq("doiKey is case-insensitive", doiKey("https://doi.org/10.1234/ABC") === doiKey("10.1234/abc"), true);
eq("doiKey of garbage is null", doiKey("nope"), null);

// ---- the publication schemas (the server's authority) ----------------------------------------------
const base = { year: 2025, title: "T", authors: "A", venue: "V" };
const parse = (doiUrl: unknown) => createPublicationSchema.safeParse({ ...base, doiUrl });
const parsed = (doiUrl: unknown) => {
  const r = parse(doiUrl);
  return r.success ? r.data.doiUrl : null;
};
eq("create: a bare DOI is stored as the canonical link", parsed("10.1234/example"), "https://doi.org/10.1234/example");
eq("create: a doi.org link is stored as the same canonical link", parsed("https://doi.org/10.1234/example"), "https://doi.org/10.1234/example");
eq("create: a doubled prefix is stored once", parsed("https://doi.org/https://doi.org/10.1234/example"), "https://doi.org/10.1234/example");
eq("create: saving the stored value again changes nothing (no prefix creep)", parsed(parsed("10.1234/example")), "https://doi.org/10.1234/example");
eq("create: empty is allowed and stays empty", parsed(""), "");
eq("create: omitted defaults to empty", (() => { const r = createPublicationSchema.safeParse(base); return r.success ? r.data.doiUrl : null; })(), "");
eq("create: an arbitrary URL is rejected", parsed("https://example.com/paper"), null);
const bad = parse("not-a-doi");
t("create: the rejection carries the readable message", !bad.success && bad.error.issues.some((i) => i.message === DOI_INVALID_MESSAGE));
eq("update: a bare DOI is normalized", (() => { const r = updatePublicationSchema.safeParse({ doiUrl: "10.9999/x" }); return r.success ? r.data.doiUrl : null; })(), "https://doi.org/10.9999/x");
eq("update: clearing with an empty string is allowed", (() => { const r = updatePublicationSchema.safeParse({ doiUrl: "" }); return r.success ? r.data.doiUrl : null; })(), "");
eq("update: a non-string is rejected, not coerced", updatePublicationSchema.safeParse({ doiUrl: 12 }).success, false);

console.log(`\n${ok} DOI unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

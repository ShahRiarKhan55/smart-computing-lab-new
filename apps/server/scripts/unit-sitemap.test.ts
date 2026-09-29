/**
 * Unit test of the Phase 26 sitemap helpers (lib/sitemap.ts). Pure functions only: no server, no
 * database. The live visibility/exclusion behavior (PUBLIC included, LAB_ONLY excluded) is covered
 * separately by scripts/sitemap-regression.mjs, which needs a real database.
 *
 *   npm run test:unit -w apps/server
 */
import { STATIC_PUBLIC_PATHS, escapeXml, normalizeBaseUrl } from "../src/lib/sitemap.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

// ---- normalizeBaseUrl ---------------------------------------------------------------------------
t("undefined -> null (unset PUBLIC_BASE_URL)", normalizeBaseUrl(undefined) === null);
t("null -> null", normalizeBaseUrl(null) === null);
t("empty string -> null", normalizeBaseUrl("") === null);
t("whitespace-only -> null", normalizeBaseUrl("   ") === null);
t("a valid https URL is kept as-is", normalizeBaseUrl("https://labs.example.edu") === "https://labs.example.edu");
t("a valid http URL is kept as-is (not upgraded, not rejected)", normalizeBaseUrl("http://localhost:8080") === "http://localhost:8080");
t("a trailing slash is stripped", normalizeBaseUrl("https://labs.example.edu/") === "https://labs.example.edu");
t("multiple trailing slashes are all stripped", normalizeBaseUrl("https://labs.example.edu///") === "https://labs.example.edu");
t("surrounding whitespace is trimmed", normalizeBaseUrl("  https://labs.example.edu  ") === "https://labs.example.edu");
t("a bare hostname with no scheme is rejected (not a valid absolute URL)", normalizeBaseUrl("labs.example.edu") === null);
t("a non-http(s) scheme is rejected", normalizeBaseUrl("ftp://labs.example.edu") === null);
t("javascript: is rejected", normalizeBaseUrl("javascript:alert(1)") === null);
t("a path is preserved rather than stripped (operator's own responsibility to configure correctly)", normalizeBaseUrl("https://example.edu/lab") === "https://example.edu/lab");
t("garbage input is rejected, not thrown", normalizeBaseUrl("not a url at all") === null);

// ---- escapeXml -----------------------------------------------------------------------------------
t("plain text passes through unchanged", escapeXml("https://labs.example.edu/team/abc123") === "https://labs.example.edu/team/abc123");
t("ampersand is escaped", escapeXml("a&b") === "a&amp;b");
t("angle brackets are escaped", escapeXml("<script>") === "&lt;script&gt;");
t("quotes are escaped", escapeXml(`"'`) === "&quot;&apos;");
t(
  "a hostile-looking id cannot break out of <loc> even though ids are server-generated, not user input",
  escapeXml('"]]></loc><script>alert(1)</script>') === "&quot;]]&gt;&lt;/loc&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
);

// ---- STATIC_PUBLIC_PATHS --------------------------------------------------------------------------
t("home page is included", STATIC_PUBLIC_PATHS.includes("/"));
t("no auth-gated path is ever in the static list", !STATIC_PUBLIC_PATHS.some((p) => ["/login", "/schedule", "/workspace", "/profile", "/messages", "/notifications", "/search"].includes(p)));
t("no admin path is ever in the static list", !STATIC_PUBLIC_PATHS.some((p) => p.startsWith("/admin")));
t("no forum path is ever in the static list (forum is LAB_ONLY community content)", !STATIC_PUBLIC_PATHS.some((p) => p.startsWith("/community")));
t("every entry is a same-app path (starts with exactly one leading slash)", STATIC_PUBLIC_PATHS.every((p) => /^\/(?!\/)/.test(p)));

console.log(`\n${ok} sitemap unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

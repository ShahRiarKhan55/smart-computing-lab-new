/**
 * Unit test of the Phase 25 open-redirect guard (`isSafeRedirectPath`, used by LoginPage's
 * post-login redirect). Pure function only: no server, no database, no DOM.   npm run test:unit -w apps/server
 */
import { isSafeRedirectPath } from "@scl/shared";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

// ---- accepted: genuine same-app paths -----------------------------------------------------------
t("root path is safe", isSafeRedirectPath("/") === true);
t("an ordinary path is safe", isSafeRedirectPath("/profile") === true);
t("a nested path is safe", isSafeRedirectPath("/community/forum/topic/abc123") === true);
t("a path with a query string is safe", isSafeRedirectPath("/search?q=lasers") === true);
t("a path with a hash is safe", isSafeRedirectPath("/research#areas") === true);
t("a backslash NOT at the very start is safe (still same-origin)", isSafeRedirectPath("/foo\\bar") === true);

// ---- rejected: shapes a browser/router can treat as protocol-relative (open redirect) ------------
t('a bare "//" (protocol-relative) is rejected', isSafeRedirectPath("//evil.example.com") === false);
t('"//" with a path after it is rejected', isSafeRedirectPath("//evil.example.com/phish") === false);
t('a leading "/\\" is rejected (the react-router advisory shape)', isSafeRedirectPath("/\\evil.example.com") === false);
t('a leading "/\\/" is rejected', isSafeRedirectPath("/\\/evil.example.com") === false);

// ---- rejected: not a same-app path at all ---------------------------------------------------------
t("an absolute URL is rejected", isSafeRedirectPath("https://evil.example.com") === false);
t("a scheme-relative URL is rejected", isSafeRedirectPath("javascript:alert(1)") === false);
t("a path with no leading slash is rejected", isSafeRedirectPath("evil.example.com") === false);
t("an empty string is rejected", isSafeRedirectPath("") === false);

// ---- rejected: wrong type (the real caller reads this off `location.state`, which is `unknown`) ---
t("undefined is rejected", isSafeRedirectPath(undefined) === false);
t("null is rejected", isSafeRedirectPath(null) === false);
t("a number is rejected", isSafeRedirectPath(42) === false);
t("an object is rejected", isSafeRedirectPath({ pathname: "/profile" }) === false);

console.log(`\n${ok} redirect-guard unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

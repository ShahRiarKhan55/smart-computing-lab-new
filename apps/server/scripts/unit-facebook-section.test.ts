/**
 * Homepage Facebook section (Phase 27 completion, item A): what visitors actually see in each state, rendered with the real
 * component and the real EN/JA dictionaries (server-side render; no browser, server, database or network).
 *
 *   tsx --tsconfig ../web/tsconfig.app.json scripts/unit-facebook-section.test.ts      (run by `npm run test:unit`)
 *
 * The component source lives in apps/web; the tsconfig flag gives it the web app's JSX settings.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { translate } from "@scl/shared";
import { LocaleProvider } from "../../web/src/i18n/LocaleContext";
import { FacebookSectionView } from "../../web/src/components/FacebookSection";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));
const render = (pageUrl: string | null, ready = true) =>
  renderToStaticMarkup(createElement(LocaleProvider, null, createElement(FacebookSectionView, { pageUrl, ready })));

const PAGE = "https://www.facebook.com/SmartComputingLab";
const linkCount = (html: string) => (html.match(/<a\b/g) ?? []).length;
const UNAVAILABLE = translate("en", "home.fbUnavailableTitle");

// ---- configured ----
{
  const html = render(PAGE);
  t("configured: the heading says what the section is", /<h2 id="home-facebook">Follow us on Facebook<\/h2>/.test(html));
  t("configured: exactly one link", linkCount(html) === 1, html);
  t("configured: link goes to the Page", html.includes(`href="${PAGE}"`));
  t("configured: opens in a new tab", html.includes('target="_blank"'));
  t("configured: noopener noreferrer", /rel="noopener noreferrer"/.test(html));
  t("configured: heading is labelled by the section", html.includes('aria-labelledby="home-facebook"') && html.includes('<h2 id="home-facebook">'));
  t("configured: visible link text", html.includes(translate("en", "home.fbAction")));
  t("configured: screen readers are told it opens a new tab", /class="sr-only"[^>]*>\s*\(opens in a new tab\)/.test(html));
  t("configured: decorative icon is hidden from assistive tech", /aria-hidden="true"/.test(html));
  t("configured: no unavailable notice", !html.includes(UNAVAILABLE));
  t("configured: shows no posts, counts or fabricated Page details", !/likes|followers|posted|ago\b/i.test(html));
}
// ---- not configured / invalid / unsafe: honest notice, never a link ----
for (const [label, v] of [
  ["null", null],
  ["empty", ""],
  ["http", "http://www.facebook.com/SmartComputingLab"],
  ["unrelated domain", "https://example.com/SmartComputingLab"],
  ["look-alike host", "https://facebook.com.evil.test/SmartComputingLab"],
  ["javascript:", "javascript:alert(1)"],
  ["credentials", "https://www.facebook.com@evil.test/x"],
  ["login endpoint", "https://www.facebook.com/login.php"],
  ["garbage", "not a url"],
] as [string, string | null][]) {
  const html = render(v);
  t(`${label}: unavailable state`, new RegExp(`<h2 id="home-facebook">${UNAVAILABLE}</h2>`).test(html), html);
  t(`${label}: no link is rendered`, linkCount(html) === 0 && !html.includes("href="), html);
  t(`${label}: the offending value is never echoed into the page`, v === null || v === "" || !html.includes(v.replace(/&/g, "&amp;")));
}
// ---- loading: nothing (no flash of "not connected" while the configuration is still being fetched) ----
t("not ready: renders nothing", render(PAGE, false) === "" && render(null, false) === "");
// ---- the page's own markup is well formed in both states ----
for (const html of [render(PAGE), render(null)]) {
  t("one section, one h2", (html.match(/<section\b/g) ?? []).length === 1 && (html.match(/<h2\b/g) ?? []).length === 1);
}
// ---- Japanese ----
{
  const jaKeys = ["home.fbEyebrow", "home.fbTitle", "home.fbDescription", "home.fbAction", "home.fbUnavailableTitle", "home.fbUnavailableText"] as const;
  t("every new key has a distinct Japanese translation (and the reused new-tab note exists in both)", translate("ja", "publications.opensInNewTab").length > 0 && translate("en", "publications.opensInNewTab").includes("new tab") && jaKeys.every((k) => translate("ja", k) !== translate("en", k) && translate("ja", k).length > 0));
}

console.log(`${ok} facebook-section unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  for (const f of failures) console.error("FAIL:", f);
  process.exit(1);
}

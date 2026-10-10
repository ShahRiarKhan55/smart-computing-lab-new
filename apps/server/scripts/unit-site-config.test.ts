/**
 * Public site settings (Phase 27 completion, item A): the official Facebook Page URL and, as a regression, the portal URL.
 * Pure functions only: no server, database or network.   npm run test:unit -w apps/server
 */
import { parseFacebookPageUrl, FACEBOOK_PAGE_URL_MAX } from "@scl/shared";
import { getFacebookPageUrl, getPortalUrl, warnIfFacebookPageUrlInvalid } from "../src/lib/siteConfig.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));
const fb = (v: unknown) => parseFacebookPageUrl(v);

// ---- accepted ----
t("www host", fb("https://www.facebook.com/SmartComputingLab") === "https://www.facebook.com/SmartComputingLab");
t("bare host", fb("https://facebook.com/SmartComputingLab") === "https://facebook.com/SmartComputingLab");
t("mobile host", fb("https://m.facebook.com/SmartComputingLab") === "https://m.facebook.com/SmartComputingLab");
t("upper-case host and scheme are normalised", fb("HTTPS://WWW.FACEBOOK.COM/SmartComputingLab") === "https://www.facebook.com/SmartComputingLab");
t("surrounding spaces are trimmed", fb("  https://www.facebook.com/SmartComputingLab  ") === "https://www.facebook.com/SmartComputingLab");
t("fragment is dropped", fb("https://www.facebook.com/SmartComputingLab#about") === "https://www.facebook.com/SmartComputingLab");
t("multi-segment page path", fb("https://www.facebook.com/people/Smart-Computing-Lab/100012345678901/") === "https://www.facebook.com/people/Smart-Computing-Lab/100012345678901/");
t("id-based page link", fb("https://www.facebook.com/profile.php?id=100012345678901") === "https://www.facebook.com/profile.php?id=100012345678901");

// ---- rejected ----
const bad: [string, unknown][] = [
  ["http scheme", "http://www.facebook.com/SmartComputingLab"],
  ["no scheme", "www.facebook.com/SmartComputingLab"],
  ["javascript:", "javascript:alert(1)"],
  ["data:", "data:text/html,<script>alert(1)</script>"],
  ["unrelated domain", "https://example.com/SmartComputingLab"],
  ["look-alike suffix", "https://facebook.com.evil.test/SmartComputingLab"],
  ["look-alike prefix", "https://evilfacebook.com/SmartComputingLab"],
  ["look-alike hyphen", "https://facebook-com.evil.test/SmartComputingLab"],
  ["sub-domain of facebook", "https://evil.facebook.com/SmartComputingLab"],
  ["other facebook-owned host", "https://fb.com/SmartComputingLab"],
  ["credentials trick", "https://www.facebook.com@evil.test/SmartComputingLab"],
  ["userinfo", "https://user:pw@www.facebook.com/SmartComputingLab"],
  ["explicit port", "https://www.facebook.com:8443/SmartComputingLab"],
  ["trailing-dot host", "https://www.facebook.com./SmartComputingLab"],
  ["unicode look-alike host", "https://www.facebo\u043ek.com/SmartComputingLab"],
  ["backslash", "https://www.facebook.com\\@evil.test/SmartComputingLab"],
  ["embedded newline", "https://www.facebook.com/Smart\nComputingLab"],
  ["embedded tab", "https://www.face\tbook.com/SmartComputingLab"],
  ["embedded space", "https://www.facebook.com/Smart ComputingLab"],
  ["site root only", "https://www.facebook.com/"],
  ["login endpoint", "https://www.facebook.com/login/?next=https%3A%2F%2Fevil.test"],
  ["login.php", "https://www.facebook.com/login.php"],
  ["sharer", "https://www.facebook.com/sharer/sharer.php?u=https://evil.test"],
  ["redirector l.php", "https://l.facebook.com/l.php?u=https://evil.test"],
  ["l.php on allowed host", "https://www.facebook.com/l.php"],
  ["dialog", "https://www.facebook.com/dialog/oauth"],
  ["query on a normal page", "https://www.facebook.com/SmartComputingLab?next=https://evil.test"],
  ["profile.php without id", "https://www.facebook.com/profile.php?foo=1"],
  ["profile.php with non-numeric id", "https://www.facebook.com/profile.php?id=abc"],
  ["empty path segment", "https://www.facebook.com//evil.test"],
  ["empty string", ""],
  ["whitespace only", "   "],
  ["garbage", "not a url"],
  ["undefined", undefined],
  ["null", null],
  ["number", 42],
  ["object", {}],
  ["too long", `https://www.facebook.com/${"a".repeat(FACEBOOK_PAGE_URL_MAX)}`],
];
for (const [label, v] of bad) t(`rejects ${label}`, fb(v) === null, JSON.stringify(fb(v)));

// ---- percent-encoding: segments are DECODED before the denylist; separators / control characters / bad encodings reject ----
const OK = "https://www.facebook.com";
for (const [label, v] of [
  ["/%6Cogin.php (encoded l)", `${OK}/%6Cogin.php`],
  ["/%6cogin.php (lower-case hex)", `${OK}/%6cogin.php`],
  ["/%4CoGiN.pHp (mixed case)", `${OK}/%4CoGiN.pHp`],
  ["/lo%67in.php", `${OK}/lo%67in.php`],
  ["/%6C%6F%67%69%6E (fully encoded login)", `${OK}/%6C%6F%67%69%6E`],
  ["/%73harer/sharer.php", `${OK}/%73harer/sharer.php`],
  ["/%6C.php (encoded l.php)", `${OK}/%6C.php`],
  ["/%64ialog/oauth", `${OK}/%64ialog/oauth`],
  ["encoded NUL: /Smart%00Lab", `${OK}/Smart%00Lab`],
  ["encoded control: /Smart%0ALab", `${OK}/Smart%0ALab`],
  ["encoded control: /Smart%1FLab", `${OK}/Smart%1FLab`],
  ["encoded DEL: /Smart%7FLab", `${OK}/Smart%7FLab`],
  ["encoded C1 control: /Smart%C2%85Lab", `${OK}/Smart%C2%85Lab`],
  ["encoded space: /Smart%20Lab", `${OK}/Smart%20Lab`],
  ["encoded tab: /Smart%09Lab", `${OK}/Smart%09Lab`],
  ["malformed: /Smart%", `${OK}/Smart%`],
  ["malformed: /Smart%G1Lab", `${OK}/Smart%G1Lab`],
  ["malformed: /Smart%1", `${OK}/Smart%1`],
  ["malformed UTF-8: /%C3%28", `${OK}/%C3%28`],
  ["encoded slash: /a%2Fb", `${OK}/a%2Fb`],
  ["encoded slash (lower): /a%2fb", `${OK}/a%2fb`],
  ["encoded backslash: /a%5Cb", `${OK}/a%5Cb`],
  ["encoded backslash (lower): /a%5cb", `${OK}/a%5cb`],
  ["encoded slash hiding login: /%2Flogin.php", `${OK}/%2Flogin.php`],
  ["double encoding: /%256Cogin.php", `${OK}/%256Cogin.php`],
  ["encoded dot segment: /%2e%2e/login.php", `${OK}/%2e%2e/login.php`],
  ["plain dot-dot: /x/../login.php", `${OK}/x/../login.php`],
] as [string, string][]) t(`rejects ${label}`, fb(v) === null, String(fb(v)));
t("an encoded dot segment is resolved by the URL parser before judging (the stored path has no dot segments)", fb(`${OK}/%2E/x`) === `${OK}/x`);
t("encoded non-ASCII Page name is fine (Japanese)", fb(`${OK}/%E3%82%B9%E3%83%9E%E3%83%BC%E3%83%88`) === `${OK}/%E3%82%B9%E3%83%9E%E3%83%BC%E3%83%88`);
t("raw non-ASCII Page name is encoded, not mangled", fb(`${OK}/スマート`) === `${OK}/%E3%82%B9%E3%83%9E%E3%83%BC%E3%83%88`);
t("encoded but harmless characters stay as given (-, ., _)", fb(`${OK}/Smart%2DComputing.Lab`) === `${OK}/Smart%2DComputing.Lab`);
t("ordinary Page with a trailing slash", fb(`${OK}/SmartComputingLab/`) === `${OK}/SmartComputingLab/`);
t("a Page's sub-page is allowed", fb(`${OK}/SmartComputingLab/about`) === `${OK}/SmartComputingLab/about`);
t("legacy numeric path", fb(`${OK}/people/Smart-Computing-Lab/100012345678901`) === `${OK}/people/Smart-Computing-Lab/100012345678901`);

// ---- query policy: profile.php?id=<digits> exception, an explicit tracking allow-list that is dropped, everything else rejects ----
t("profile.php?id=digits stays", fb(`${OK}/profile.php?id=100012345678901`) === `${OK}/profile.php?id=100012345678901`);
t("PROFILE.PHP (case) with id", fb(`${OK}/PROFILE.PHP?id=12`) === `${OK}/PROFILE.PHP?id=12`);
t("encoded profile.php with id", fb(`${OK}/%70rofile.php?id=12`) === `${OK}/%70rofile.php?id=12`);
t("profile.php without id rejected", fb(`${OK}/profile.php`) === null);
t("profile.php with empty id rejected", fb(`${OK}/profile.php?id=`) === null);
t("profile.php with non-digit id rejected", fb(`${OK}/profile.php?id=12a`) === null);
t("profile.php with 21-digit id rejected", fb(`${OK}/profile.php?id=${"1".repeat(21)}`) === null);
t("profile.php with a repeated id rejected", fb(`${OK}/profile.php?id=1&id=2`) === null);
t("profile.php with an unknown extra parameter rejected", fb(`${OK}/profile.php?id=12&next=https://evil.test`) === null);
t("id on a normal Page rejected", fb(`${OK}/SmartComputingLab?id=12`) === null);
for (const [label, v, want] of [
  ["mibextid is dropped", `${OK}/SmartComputingLab?mibextid=ZbWKwL`, `${OK}/SmartComputingLab`],
  ["ref is dropped", `${OK}/SmartComputingLab?ref=share`, `${OK}/SmartComputingLab`],
  ["fbclid is dropped", `${OK}/SmartComputingLab?fbclid=IwAR0abc`, `${OK}/SmartComputingLab`],
  ["all three are dropped", `${OK}/SmartComputingLab/?mibextid=a&ref=b&fbclid=c`, `${OK}/SmartComputingLab/`],
  ["a repeated tracking parameter is dropped", `${OK}/SmartComputingLab?ref=a&ref=b`, `${OK}/SmartComputingLab`],
  ["tracking parameters are dropped beside profile.php id", `${OK}/profile.php?id=12&mibextid=x`, `${OK}/profile.php?id=12`],
  ["a tracking value that looks like a URL is dropped, not followed", `${OK}/SmartComputingLab?ref=https%3A%2F%2Fevil.test`, `${OK}/SmartComputingLab`],
  ["a fragment after tracking is dropped", `${OK}/SmartComputingLab?mibextid=a#x`, `${OK}/SmartComputingLab`],
  ["an empty query marker is dropped", `${OK}/SmartComputingLab?`, `${OK}/SmartComputingLab`],
] as [string, string, string][]) t(label, fb(v) === want, String(fb(v)));
for (const [label, v] of [
  ["an unknown parameter", `${OK}/SmartComputingLab?next=https://evil.test`],
  ["an unknown parameter beside a tracking one", `${OK}/SmartComputingLab?mibextid=a&next=x`],
  ["a redirect-style parameter", `${OK}/SmartComputingLab?u=https%3A%2F%2Fevil.test`],
  ["an upper-case tracking name (case-sensitive)", `${OK}/SmartComputingLab?REF=share`],
  ["a near-miss tracking name", `${OK}/SmartComputingLab?mibextid2=a`],
  ["an empty parameter name", `${OK}/SmartComputingLab?=x`],
  ["a bare unknown flag", `${OK}/SmartComputingLab?utm`],
] as [string, string][]) t(`rejects ${label}`, fb(v) === null, String(fb(v)));
t("host rules are unchanged: web.facebook.com is still rejected", fb("https://web.facebook.com/SmartComputingLab") === null);
t("host rules are unchanged: http still rejected even with a clean path", fb("http://www.facebook.com/SmartComputingLab") === null);

// ---- startup notice for an invalid optional setting ----
{
  const warn = (env: Record<string, string | undefined>) => {
    const out: string[] = [];
    const warned = warnIfFacebookPageUrlInvalid(env as unknown as NodeJS.ProcessEnv, (m) => out.push(m));
    return { warned, out };
  };
  const secretish = "https://www.facebook.com@evil.test/SECRET-PATH-TOKEN-12345";
  const r1 = warn({ FACEBOOK_PAGE_URL: secretish });
  t("invalid value -> one warning", r1.warned && r1.out.length === 1);
  t("the warning never repeats the supplied value", !r1.out.join("").includes("SECRET-PATH-TOKEN") && !r1.out.join("").includes("evil.test"));
  t("the warning names the setting and the resulting state", /FACEBOOK_PAGE_URL/.test(r1.out[0]) && /not connected/.test(r1.out[0]));
  t("unset -> no warning", !warn({}).warned && warn({}).out.length === 0);
  t("blank -> no warning", !warn({ FACEBOOK_PAGE_URL: "   " }).warned);
  t("valid -> no warning", !warn({ FACEBOOK_PAGE_URL: "https://www.facebook.com/SmartComputingLab" }).warned);
  t("valid with tracking -> no warning", !warn({ FACEBOOK_PAGE_URL: "https://www.facebook.com/SmartComputingLab?mibextid=x" }).warned);
  t("http -> warning", warn({ FACEBOOK_PAGE_URL: "http://www.facebook.com/x" }).warned);
  t("never throws on odd input", (() => { try { warn({ FACEBOOK_PAGE_URL: "\u0000%%%" }); return true; } catch { return false; } })());
}

// ---- the server setting ----
const env = (v: string | undefined) => ({ FACEBOOK_PAGE_URL: v }) as unknown as NodeJS.ProcessEnv;
t("unset -> null", getFacebookPageUrl({} as NodeJS.ProcessEnv) === null);
t("empty -> null", getFacebookPageUrl(env("")) === null);
t("valid -> normalised URL", getFacebookPageUrl(env("https://www.facebook.com/SmartComputingLab")) === "https://www.facebook.com/SmartComputingLab");
t("http -> null", getFacebookPageUrl(env("http://www.facebook.com/SmartComputingLab")) === null);
t("lookalike -> null", getFacebookPageUrl(env("https://facebook.com.evil.test/x")) === null);
t("copied link with tracking -> clean URL", getFacebookPageUrl(env("https://www.facebook.com/SmartComputingLab?mibextid=ZbWKwL")) === "https://www.facebook.com/SmartComputingLab");
t("does not read the portal setting", getFacebookPageUrl({ PORTAL_URL: "https://www.facebook.com/x" } as unknown as NodeJS.ProcessEnv) === null);

// ---- regression: the portal URL behaves as before and is independent of the Facebook setting ----
t("portal: valid https", getPortalUrl({ PORTAL_URL: "https://sites.google.com/view/x" } as unknown as NodeJS.ProcessEnv) === "https://sites.google.com/view/x");
t("portal: http ignored", getPortalUrl({ PORTAL_URL: "http://sites.google.com/view/x" } as unknown as NodeJS.ProcessEnv) === null);
t("portal: unset", getPortalUrl({} as NodeJS.ProcessEnv) === null);
t("portal: facebook setting does not leak into it", getPortalUrl({ FACEBOOK_PAGE_URL: "https://www.facebook.com/x" } as unknown as NodeJS.ProcessEnv) === null);

console.log(`${ok} site-config unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  for (const f of failures) console.error("FAIL:", f);
  process.exit(1);
}

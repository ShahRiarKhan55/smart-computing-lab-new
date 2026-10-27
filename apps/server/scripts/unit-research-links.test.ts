/**
 * Unit checks for Phase 3C research-profile link validation (Google Scholar, ResearchGate, ORCID). Pure functions and zod
 * schemas: no server, no database, no network.   npm run test:unit -w apps/server
 */
import {
  GOOGLE_SCHOLAR_HOSTS, createTeamMemberSchema, isGoogleScholarUrl, isOrcidUrl, isResearchGateUrl, normalizeGoogleScholarUrl,
  normalizeOrcidUrl, normalizeResearchGateUrl, orcidCheckChar, updateOwnProfileSchema, updateTeamMemberSchema, RESEARCH_LINK_MESSAGES,
} from "@scl/shared";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));
const eq = (name: string, got: unknown, want: unknown) => t(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const UID = "AbCdEfGhIjKl"; // 12 chars
const UNSAFE = [
  "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "vbscript:x", "ftp://scholar.google.com/citations?user=" + UID,
  "//scholar.google.com/citations?user=" + UID, "http://scholar.google.com/citations?user=" + UID,
];
const injected = (base: string) => [
  base.replace("https://", "https://user:pw@"), base.replace("https://", "https://user@"), base.replace(/^(https:\/\/[^/]+)/, "$1:443"), base.replace(/^(https:\/\/[^/]+)/, "$1:8080"),
  base.replace("https://", "https:\\\\"), base.replace("https://", "https:/"), " " + base.replace("https://", "https:// "), base + " x", base.replace(/^(https:\/\/[^/]+)/, "$1\n"), base + "\nx", base.replace(/^(https:\/\/[^/]+)/, "$1%2e"),
  base.replace("https://", "https://xn--"), base.toUpperCase().replace("HTTPS", "https").replace(/^(https:\/\/[^/]+)/, (m) => m.toLowerCase()).replace(/\/$/, "") + "<", base + "'\"",
];

// ======================= Google Scholar =======================================================================================
{
  const base = `https://scholar.google.com/citations?user=${UID}`;
  eq("GS: canonical form accepted unchanged", normalizeGoogleScholarUrl(base), base);
  eq("GS: surrounding whitespace trimmed", normalizeGoogleScholarUrl(`  ${base}\n`), base);
  eq("GS: hl/view_op/oi tracking-ish params dropped", normalizeGoogleScholarUrl(`${base}&hl=en&view_op=list_works&oi=ao`), base);
  eq("GS: params in another order", normalizeGoogleScholarUrl(`https://scholar.google.com/citations?hl=ja&user=${UID}`), base);
  eq("GS: fragment dropped", normalizeGoogleScholarUrl(`${base}#section`), base);
  eq("GS: trailing slash on /citations", normalizeGoogleScholarUrl(`https://scholar.google.com/citations/?user=${UID}`), base);
  eq("GS: host case-insensitive, output lowercase", normalizeGoogleScholarUrl(`https://SCHOLAR.Google.COM/citations?user=${UID}`), base);
  eq("GS: id with _ and -", normalizeGoogleScholarUrl("https://scholar.google.com/citations?user=a_b-c_d-e_f-"), "https://scholar.google.com/citations?user=a_b-c_d-e_f-");
  // country variants: every host in the allow-list works; a spread of real ones by name
  for (const h of ["scholar.google.co.jp", "scholar.google.co.uk", "scholar.google.com.bd", "scholar.google.de", "scholar.google.fr", "scholar.google.co.in", "scholar.google.com.au", "scholar.google.ca", "scholar.google.com.sg"]) {
    t(`GS: country domain ${h} is in the allow-list`, GOOGLE_SCHOLAR_HOSTS.includes(h));
    eq(`GS: ${h} accepted`, normalizeGoogleScholarUrl(`https://${h}/citations?user=${UID}`), `https://${h}/citations?user=${UID}`);
  }
  t("GS: allow-list is large and duplicate-free", GOOGLE_SCHOLAR_HOSTS.length > 150 && new Set(GOOGLE_SCHOLAR_HOSTS).size === GOOGLE_SCHOLAR_HOSTS.length, String(GOOGLE_SCHOLAR_HOSTS.length));
  t("GS: every allow-listed host is scholar.google.<tld>", GOOGLE_SCHOLAR_HOSTS.every((h) => /^scholar\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h)));
  for (const bad of [
    "https://scholar.google.com.evil.example/citations?user=" + UID, "https://scholar.google.com.evil.com/citations?user=" + UID, "https://evilscholar.google.com/citations?user=" + UID,
    "https://scholar-google.com/citations?user=" + UID, "https://scholar.google.zz/citations?user=" + UID, "https://scholar.google/citations?user=" + UID,
    "https://scholar.google.com.attacker.io/citations?user=" + UID, "https://google.com/citations?user=" + UID, "https://www.google.com/citations?user=" + UID,
    "https://scholar.googIe.com/citations?user=" + UID, "https://scholar.google.cоm/citations?user=" + UID /* Cyrillic o */, "https://a.scholar.google.com/citations?user=" + UID,
    "https://scholar.google.com./citations?user=" + UID, "https://scholar.google.com:evil@evil.example/citations?user=" + UID,
    "https://researchgate.net/profile/Jane-Doe", "https://orcid.org/0000-0002-1825-0097",
    `https://scholar.google.com/citations?user=${UID}x`, "https://scholar.google.com/citations?user=short", "https://scholar.google.com/citations?user=", "https://scholar.google.com/citations",
    "https://scholar.google.com/citations?hl=en", `https://scholar.google.com/citations?user=${UID}&user=${UID}`, `https://scholar.google.com/citations?user=${UID}&redirect=https://evil.example`,
    `https://scholar.google.com/citations?user=${UID}&utm_source=x`, `https://scholar.google.com/scholar?q=x&user=${UID}`, `https://scholar.google.com/citations/evil?user=${UID}`,
    `https://scholar.google.com/url?q=https://evil.example&user=${UID}`, "https://scholar.google.com/citations?user=ab cdefghijkl", "https://scholar.google.com/citations?user=%41bCdEfGhIjKl",
    "", "   ", "scholar.google.com/citations?user=" + UID, "x".repeat(400),
    ...UNSAFE, ...injected(base),
  ]) t(`GS: refuses ${JSON.stringify(bad).slice(0, 70)}`, normalizeGoogleScholarUrl(bad) === null);
  t("GS: isGoogleScholarUrl accepts canonical only", isGoogleScholarUrl(base) && !isGoogleScholarUrl(base + "&hl=en") && !isGoogleScholarUrl("") && !isGoogleScholarUrl("javascript:alert(1)"));
}

// ======================= ResearchGate =========================================================================================
{
  const want = "https://www.researchgate.net/profile/Jane-Doe-12";
  eq("RG: canonical accepted", normalizeResearchGateUrl(want), want);
  eq("RG: no www normalised to www", normalizeResearchGateUrl("https://researchgate.net/profile/Jane-Doe-12"), want);
  eq("RG: trailing slash removed", normalizeResearchGateUrl(want + "/"), want);
  eq("RG: tracking query dropped", normalizeResearchGateUrl(want + "?_tp=abc&utm_source=x"), want);
  eq("RG: fragment dropped", normalizeResearchGateUrl(want + "#top"), want);
  eq("RG: host case-insensitive", normalizeResearchGateUrl("https://WWW.ResearchGate.NET/profile/Jane-Doe-12"), want);
  eq("RG: dots and underscores in slug", normalizeResearchGateUrl("https://www.researchgate.net/profile/J.Doe_2"), "https://www.researchgate.net/profile/J.Doe_2");
  eq("RG: whitespace trimmed", normalizeResearchGateUrl(` ${want} `), want);
  for (const bad of [
    "https://www.researchgate.net.evil.example/profile/Jane", "https://evilresearchgate.net/profile/Jane", "https://researchgate.net.evil.com/profile/Jane", "https://research-gate.net/profile/Jane",
    "https://www.researchgate.com/profile/Jane", "https://m.researchgate.net/profile/Jane", "https://sub.www.researchgate.net/profile/Jane", "https://www.researchgate.net./profile/Jane",
    "https://www.researchgate.net/publication/12345", "https://www.researchgate.net/profile", "https://www.researchgate.net/profile/", "https://www.researchgate.net/profile/Jane/extra",
    "https://www.researchgate.net/profile/Jane/../../x", "https://www.researchgate.net/profile/..", "https://www.researchgate.net/profile/.x", "https://www.researchgate.net/profile/a",
    "https://www.researchgate.net/profile/Jane%2FDoe", "https://www.researchgate.net/profile/Ja ne", "https://www.researchgate.net/profile/Jane<script>", "https://www.researchgate.net/profile/" + "a".repeat(101),
    "https://www.researchgate.net/Jane-Doe", "https://www.researchgate.net/", "https://www.researchgate.net",
    "https://scholar.google.com/citations?user=" + UID, "https://orcid.org/0000-0002-1825-0097",
    "", "  ", "www.researchgate.net/profile/Jane", "x".repeat(400),
    ...UNSAFE, ...injected(want),
  ]) t(`RG: refuses ${JSON.stringify(bad).slice(0, 70)}`, normalizeResearchGateUrl(bad) === null);
  t("RG: isResearchGateUrl accepts canonical only", isResearchGateUrl(want) && !isResearchGateUrl(want + "/") && !isResearchGateUrl("https://researchgate.net/profile/Jane") && !isResearchGateUrl(""));
}

// ======================= ORCID ================================================================================================
{
  const valid = ["0000-0002-1825-0097", "0000-0001-5109-3700", "0000-0002-1694-233X", "0000-0003-1415-9269", "0000-0002-9079-593X"];
  for (const id of valid) {
    eq(`ORCID: bare ${id}`, normalizeOrcidUrl(id), `https://orcid.org/${id}`);
    eq(`ORCID: url ${id}`, normalizeOrcidUrl(`https://orcid.org/${id}`), `https://orcid.org/${id}`);
  }
  eq("ORCID: www host normalised", normalizeOrcidUrl("https://www.orcid.org/0000-0002-1825-0097"), "https://orcid.org/0000-0002-1825-0097");
  eq("ORCID: trailing slash", normalizeOrcidUrl("https://orcid.org/0000-0002-1825-0097/"), "https://orcid.org/0000-0002-1825-0097");
  eq("ORCID: query/fragment dropped", normalizeOrcidUrl("https://orcid.org/0000-0002-1825-0097?lang=en#x"), "https://orcid.org/0000-0002-1825-0097");
  eq("ORCID: whitespace trimmed", normalizeOrcidUrl("  0000-0002-1825-0097  "), "https://orcid.org/0000-0002-1825-0097");
  eq("ORCID: host case-insensitive", normalizeOrcidUrl("https://ORCID.org/0000-0002-1694-233X"), "https://orcid.org/0000-0002-1694-233X");
  t("ORCID: check character computed (incl. X)", orcidCheckChar("000000021694233") === "X" && orcidCheckChar("000000021825009") === "7" && orcidCheckChar("000000015109370") === "0");
  // exhaustively: for a sample of 15-digit prefixes the computed check char always validates, and every other final char fails
  let sweep = true;
  for (let i = 0; i < 400; i++) {
    const p = String(1000003 * i + 7).padStart(15, "0");
    const good = orcidCheckChar(p);
    const fmt = (c: string) => `${p.slice(0, 4)}-${p.slice(4, 8)}-${p.slice(8, 12)}-${p.slice(12)}${c}`;
    if (normalizeOrcidUrl(fmt(good)) === null) sweep = false;
    for (const c of "0123456789X") if (c !== good && normalizeOrcidUrl(fmt(c)) !== null) sweep = false;
  }
  t("ORCID: check digit accepted iff correct over 400 prefixes x 11 characters", sweep);
  for (const bad of [
    "0000-0002-1825-0098", "0000-0002-1825-009X", "0000-0002-1694-2330", "0000-0002-1694-233x", "0000000218250097", "0000 0002 1825 0097", "0000-0002-1825-009", "0000-0002-1825-00977",
    "000-0002-1825-0097", "0000-0002-1825-X097", "X000-0002-1825-0097", "0000-0002-1825", "abcd-efgh-ijkl-mnop", "0000-0002-1825-0097-0000",
    "https://orcid.org/0000-0002-1825-0098", "http://orcid.org/0000-0002-1825-0097", "https://orcid.org.evil.example/0000-0002-1825-0097", "https://evilorcid.org/0000-0002-1825-0097",
    "https://orcid.org@evil.example/0000-0002-1825-0097", "https://sandbox.orcid.org/0000-0002-1825-0097", "https://pub.orcid.org/0000-0002-1825-0097", "https://orcid.org./0000-0002-1825-0097",
    "https://orcid.org/", "https://orcid.org", "https://orcid.org/my-orcid", "https://orcid.org/0000-0002-1825-0097/works", "https://orcid.org/0000-0002-1825-0097/../x", "https://orcid.org/orcid/0000-0002-1825-0097",
    "https://orcid.org/0000-0002-1825-0097%00", "https://orcid.org/%30000-0002-1825-0097", "https://orcid.org/0000-0002-1825-0097<", "orcid.org/0000-0002-1825-0097",
    "https://scholar.google.com/citations?user=" + UID, "https://www.researchgate.net/profile/Jane", "", "  ", "x".repeat(400),
    ...UNSAFE, ...injected("https://orcid.org/0000-0002-1825-0097"),
  ]) t(`ORCID: refuses ${JSON.stringify(bad).slice(0, 70)}`, normalizeOrcidUrl(bad) === null);
  t("ORCID: isOrcidUrl accepts canonical only", isOrcidUrl("https://orcid.org/0000-0002-1825-0097") && !isOrcidUrl("0000-0002-1825-0097") && !isOrcidUrl("https://www.orcid.org/0000-0002-1825-0097"));
}

// ======================= cross-service: one service's URL is never accepted by another ========================================
{
  const gs = `https://scholar.google.com/citations?user=${UID}`, rg = "https://www.researchgate.net/profile/Jane-Doe", oc = "https://orcid.org/0000-0002-1825-0097";
  t("cross: each validator accepts only its own service", normalizeGoogleScholarUrl(rg) === null && normalizeGoogleScholarUrl(oc) === null && normalizeResearchGateUrl(gs) === null &&
    normalizeResearchGateUrl(oc) === null && normalizeOrcidUrl(gs) === null && normalizeOrcidUrl(rg) === null);
}

// ======================= the request schemas (shared by admin create/edit and the own-profile form) ===========================
{
  const base = { name: "N", initials: "N", role: "r", category: "MSC" as const };
  const gs = `https://scholar.google.co.jp/citations?user=${UID}`, rg = "https://www.researchgate.net/profile/Jane-Doe", oc = "0000-0002-1825-0097";
  const c = createTeamMemberSchema.safeParse({ ...base, googleScholarUrl: gs + "&hl=ja", researchGateUrl: rg + "?utm=x", orcidUrl: oc });
  t("create: all three accepted and canonicalised", c.success && c.data.googleScholarUrl === gs && c.data.researchGateUrl === rg && c.data.orcidUrl === "https://orcid.org/" + oc);
  const d = createTeamMemberSchema.safeParse(base);
  t("create: omitted links default to empty", d.success && d.data.googleScholarUrl === "" && d.data.researchGateUrl === "" && d.data.orcidUrl === "");
  const e = createTeamMemberSchema.safeParse({ ...base, googleScholarUrl: "  ", researchGateUrl: "", orcidUrl: "" });
  t("create: blank links mean none", e.success && e.data.googleScholarUrl === "" && e.data.orcidUrl === "");
  for (const [field, bad, msg] of [
    ["googleScholarUrl", "javascript:alert(1)", RESEARCH_LINK_MESSAGES.googleScholar], ["researchGateUrl", "https://evil.example/profile/x", RESEARCH_LINK_MESSAGES.researchGate],
    ["orcidUrl", "0000-0002-1825-0098", RESEARCH_LINK_MESSAGES.orcid], ["googleScholarUrl", rg, RESEARCH_LINK_MESSAGES.googleScholar],
  ] as const) {
    const r = createTeamMemberSchema.safeParse({ ...base, [field]: bad });
    t(`create: ${field} rejects ${bad.slice(0, 30)} with the fixed message`, !r.success && r.error.issues.some((i) => i.path[0] === field && i.message === msg));
  }
  t("create: a non-string link is rejected, not coerced", !createTeamMemberSchema.safeParse({ ...base, orcidUrl: 123 }).success && !createTeamMemberSchema.safeParse({ ...base, orcidUrl: null }).success &&
    !createTeamMemberSchema.safeParse({ ...base, googleScholarUrl: ["x"] }).success);
  t("create: a 100 KB link is refused cheaply", !createTeamMemberSchema.safeParse({ ...base, researchGateUrl: "a".repeat(100_000) }).success);
  const u = updateTeamMemberSchema.safeParse({ orcidUrl: oc });
  t("admin update: a single link field is a valid update", u.success && u.data.orcidUrl === "https://orcid.org/" + oc);
  const u2 = updateTeamMemberSchema.safeParse({ orcidUrl: "" });
  t("admin update: clearing a link ('') is a valid update", u2.success && u2.data.orcidUrl === "");
  t("admin update: invalid link refused", !updateTeamMemberSchema.safeParse({ googleScholarUrl: "https://scholar.google.com.evil.example/citations?user=" + UID }).success);
  const p = updateOwnProfileSchema.safeParse({ googleScholarUrl: gs, researchGateUrl: rg, orcidUrl: oc });
  t("own profile: same canonical output as admin", p.success && p.data.googleScholarUrl === gs && p.data.researchGateUrl === rg && p.data.orcidUrl === "https://orcid.org/" + oc);
  const p2 = updateOwnProfileSchema.safeParse({ researchGateUrl: "" });
  t("own profile: clearing a link is a valid update", p2.success && p2.data.researchGateUrl === "");
  for (const f of ["googleScholarUrl", "researchGateUrl", "orcidUrl"]) t(`own profile: ${f} 'javascript:' refused`, !updateOwnProfileSchema.safeParse({ [f]: "javascript:alert(1)" }).success);
  t("own profile: no link fields and nothing else is still 'Nothing to update'", !updateOwnProfileSchema.safeParse({}).success);
  // parity: identical verdict from admin and self schemas for the same inputs
  let parity = true;
  for (const v of [gs, rg, oc, "javascript:x", "", "https://orcid.org/0000-0002-1825-0097", "https://scholar.google.com.evil.example/citations?user=" + UID]) for (const f of ["googleScholarUrl", "researchGateUrl", "orcidUrl"]) {
    const a = updateTeamMemberSchema.safeParse({ [f]: v }), b = updateOwnProfileSchema.safeParse({ [f]: v });
    if (a.success !== b.success || (a.success && b.success && (a.data as Record<string, unknown>)[f] !== (b.data as Record<string, unknown>)[f])) parity = false;
  }
  t("admin and own-profile schemas give identical verdicts and output", parity);
}

console.log(`${ok} research-link unit checks passed, ${failures.length} failed.`);
if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }

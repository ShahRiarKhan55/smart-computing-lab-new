/**
 * Unit checks for the duplicate-warning helpers (packages/shared/src/duplicates.ts): normalisation (case, whitespace, punctuation,
 * accents, scripts), canonical DOIs from every URL form, the four matchers, the update schemas' "Nothing to update." rule and the
 * override permission. No server, no database, no network.   npm run test:unit -w apps/server
 */
import {
  DUPLICATE_MESSAGES,
  canOverrideDuplicate,
  canonicalDoi,
  createNewsItemSchema,
  createPublicationSchema,
  createResearchAreaSchema,
  createTeamMemberSchema,
  findNameMatches,
  findNewsMatches,
  findPublicationMatches,
  findResearchAreaMatches,
  normalizeText,
  personNameKey,
  updateNewsItemSchema,
  updateOwnProfileSchema,
  updatePublicationSchema,
  updateResearchAreaSchema,
  updateTeamMemberSchema,
} from "@scl/shared";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));

// ---- normalizeText -----------------------------------------------------------------------------------------------------------
t("normalizeText: case", normalizeText("Machine LEARNING") === "machine learning");
t("normalizeText: leading/trailing/inner whitespace (tabs, newlines, NBSP)", normalizeText("  a \t b\n  c  ") === "a b c");
t("normalizeText: punctuation becomes a single separator", normalizeText("K.M  Shahriar-Alam, Adib!") === "k m shahriar alam adib");
t("normalizeText: Latin accents are folded", normalizeText("José Müller") === "jose muller");
t("normalizeText: & reads as and", normalizeText("Wafer & Semiconductor") === normalizeText("wafer AND semiconductor") && normalizeText("R&D") === "r and d");
t("normalizeText: full-width letters fold (NFKC)", normalizeText("ＡＩ　Ｍｌ") === "ai ml");
t("normalizeText: Japanese text is kept (not stripped to nothing)", normalizeText("機械学習 の 研究") === "機械学習 の 研究");
t("normalizeText: Japanese voiced marks are NOT folded (か != が)", normalizeText("か") !== normalizeText("が"));
t("normalizeText: null / undefined / empty", normalizeText(null) === "" && normalizeText(undefined) === "" && normalizeText("") === "");
t("normalizeText: punctuation only is empty", normalizeText("...---") === "");
t("normalizeText is idempotent", normalizeText(normalizeText("A.B  C")) === normalizeText("A.B  C"));

// ---- personNameKey -----------------------------------------------------------------------------------------------------------
t("personNameKey: case, spacing and punctuation", personNameKey("K.M Shahriar Alam Adib") === personNameKey("  k.m   SHAHRIAR alam adib "));
t("personNameKey: family-name order", personNameKey("Wang Weiquan") === personNameKey("Weiquan Wang"));
t("personNameKey: honorifics are ignored", personNameKey("Assistant Prof. Riaz-Ul-Haque Mian") === personNameKey("Riaz-ul-haque Mian"));
t("personNameKey: Dr / Prof prefix", personNameKey("Dr. Ada Lovelace") === personNameKey("Ada Lovelace") && personNameKey("Prof Ada Lovelace") === personNameKey("ada lovelace"));
t("personNameKey: a name made ONLY of title words still has a key", personNameKey("Professor") !== "");
t("personNameKey: different people differ", personNameKey("Alice Adams") !== personNameKey("Alice Adamson"));
t("personNameKey: an empty or punctuation-only name has no key", personNameKey("") === "" && personNameKey(" . ") === "");

// ---- canonicalDoi ------------------------------------------------------------------------------------------------------------
const DOI = "10.1145/3765907";
t("canonicalDoi: https://doi.org/", canonicalDoi("https://doi.org/10.1145/3765907") === DOI);
t("canonicalDoi: http://dx.doi.org/", canonicalDoi("http://dx.doi.org/10.1145/3765907") === DOI);
t("canonicalDoi: www.doi.org and trailing slash", canonicalDoi("https://www.doi.org/10.1145/3765907/") === DOI);
t("canonicalDoi: doi: prefix and bare DOI", canonicalDoi("doi:10.1145/3765907") === DOI && canonicalDoi("10.1145/3765907") === DOI && canonicalDoi("DOI: 10.1145/3765907") === DOI);
t("canonicalDoi: upper case is lower-cased", canonicalDoi("https://doi.org/10.1016/J.VLSI.2025.102609") === "10.1016/j.vlsi.2025.102609");
t("canonicalDoi: query string and fragment are dropped", canonicalDoi("https://doi.org/10.1145/3765907?utm_source=x#top") === DOI);
t("canonicalDoi: trailing punctuation is dropped", canonicalDoi("https://doi.org/10.1145/3765907).") === DOI);
t("canonicalDoi: percent-encoded slash", canonicalDoi("https://doi.org/10.1145%2F3765907") === DOI);
t("canonicalDoi: a publisher URL that carries the DOI", canonicalDoi("https://dl.acm.org/doi/10.1145/3765907") === DOI);
t("canonicalDoi: an arXiv DOI keeps its case-insensitive body", canonicalDoi("https://doi.org/10.48550/arXiv.2506.03556") === "10.48550/arxiv.2506.03556");
t("canonicalDoi: a DOI containing parentheses and underscores", canonicalDoi("https://doi.org/10.1016/S0022-2836(05)80360-2") === "10.1016/s0022-2836(05)80360-2");
t("canonicalDoi: no DOI in the text", canonicalDoi("https://example.com/paper.pdf") === null && canonicalDoi("") === null && canonicalDoi(null) === null && canonicalDoi(undefined) === null);
t("canonicalDoi: a malformed percent escape does not throw", canonicalDoi("https://doi.org/10.1145/3765907%E0%A4%A") === "10.1145/3765907%e0%a4%a");
t("canonicalDoi: variants of one DOI are equal", new Set(["https://doi.org/10.1145/3765907", "http://dx.doi.org/10.1145/3765907/", "doi:10.1145/3765907", "https://DOI.org/10.1145/3765907?x=1"].map(canonicalDoi)).size === 1);

// ---- findNameMatches ---------------------------------------------------------------------------------------------------------
const people = [
  { id: "p1", name: "K.M Shahriar Alam Adib" },
  { id: "p2", name: "Wang Weiquan" },
  { id: "p3", name: "Gulnaz" },
];
t("findNameMatches: exact", findNameMatches("K.M Shahriar Alam Adib", people).map((p) => p.id).join() === "p1");
t("findNameMatches: case/space/punctuation variant", findNameMatches("k.m  shahriar alam   ADIB", people).map((p) => p.id).join() === "p1");
t("findNameMatches: family-name order", findNameMatches("Weiquan Wang", people).map((p) => p.id).join() === "p2");
t("findNameMatches: the record being edited is excluded", findNameMatches("Gulnaz", people, "p3").length === 0);
t("findNameMatches: a different person is not matched", findNameMatches("Gulnaz Khan", people).length === 0);
t("findNameMatches: an empty name matches nothing", findNameMatches("", people).length === 0 && findNameMatches(" . ", [{ id: "x", name: "." }]).length === 0);
t("findNameMatches: reports every match", findNameMatches("Gulnaz", [...people, { id: "p4", name: "GULNAZ" }]).map((p) => p.id).join() === "p3,p4");

// ---- findPublicationMatches --------------------------------------------------------------------------------------------------
// The distinct pair identified in the audit: a 2026 journal paper and its 2025 conference/preprint predecessor.
const JOURNAL = { id: "j", year: 2026, title: "Optimizing FPGA and Wafer Test Coverage with Spatial Sampling and Machine Learning: Analysis of Local Spatial Consistency", doiUrl: "https://doi.org/10.3390/signals7030053" };
const CONF = { id: "c", year: 2025, title: "Optimizing FPGA and wafer test coverage with spatial sampling and machine learning", doiUrl: "https://doi.org/10.48550/arXiv.2506.03556" };
const pubs = [JOURNAL, CONF, { id: "n", year: 2025, title: "A paper without a DOI", doiUrl: "" }];
t("publication: the audit's journal/conference pair are NOT duplicates of each other", findPublicationMatches(JOURNAL, [CONF], "j").length === 0 && findPublicationMatches(CONF, [JOURNAL], "c").length === 0);
t("publication: creating the conference version when only the journal exists is allowed", findPublicationMatches({ title: CONF.title, year: 2025, doiUrl: CONF.doiUrl }, [JOURNAL]).length === 0);
t("publication: same DOI in another URL form is a DOI duplicate", findPublicationMatches({ title: "Anything", year: 2020, doiUrl: "http://dx.doi.org/10.3390/SIGNALS7030053/" }, pubs)[0]?.kind === "doi");
t("publication: same title + year but DIFFERENT DOIs (preprint vs journal) is allowed", findPublicationMatches({ title: CONF.title, year: 2025, doiUrl: "https://doi.org/10.1109/icecet.2025.1" }, [CONF]).length === 0);
t("publication: same title and year, no DOI on the new one: likely duplicate", findPublicationMatches({ title: "optimizing FPGA and wafer test coverage, with spatial sampling and machine learning!", year: 2025, doiUrl: "" }, [CONF])[0]?.kind === "title-year");
t("publication: same title and year, no DOI on the existing one: likely duplicate", findPublicationMatches({ title: "A Paper Without a DOI", year: 2025, doiUrl: "https://doi.org/10.1/abcd" }, pubs).some((m) => m.kind === "title-year" && m.record.id === "n"));
t("publication: same title but another year, no DOIs: allowed", findPublicationMatches({ title: "A paper without a DOI", year: 2026, doiUrl: "" }, pubs).length === 0);
t("publication: the record being edited is excluded", findPublicationMatches({ title: JOURNAL.title, year: 2026, doiUrl: JOURNAL.doiUrl }, pubs, "j").length === 0);
t("publication: an unrelated title is not matched", findPublicationMatches({ title: "Something else", year: 2025, doiUrl: "" }, pubs).length === 0);
t("publication: a DOI that is not parseable counts as no DOI", findPublicationMatches({ title: "A paper without a DOI", year: 2025, doiUrl: "https://example.com/x" }, pubs)[0]?.kind === "title-year");

// ---- findNewsMatches ---------------------------------------------------------------------------------------------------------
const news = [{ id: "a", title: "PhD positions available", dateLabel: "February 2025", sortDate: "2025-02-01" }];
t("news: same title, same display date", findNewsMatches({ title: "phd positions  AVAILABLE!", dateLabel: "february 2025", sortDate: "2025-02-15" }, news).length === 1);
t("news: same title, same sort date, different label", findNewsMatches({ title: "PhD positions available", dateLabel: "Feb 1, 2025", sortDate: "2025-02-01" }, news).length === 1);
t("news: a recurring announcement on a different date is allowed", findNewsMatches({ title: "PhD positions available", dateLabel: "February 2026", sortDate: "2026-02-01" }, news).length === 0);
t("news: same date, different title is allowed", findNewsMatches({ title: "Seminar", dateLabel: "February 2025", sortDate: "2025-02-01" }, news).length === 0);
t("news: the record being edited is excluded", findNewsMatches({ title: "PhD positions available", dateLabel: "February 2025", sortDate: "2025-02-01" }, news, "a").length === 0);
t("news: an empty title matches nothing", findNewsMatches({ title: "", dateLabel: "February 2025", sortDate: "2025-02-01" }, news).length === 0);

// ---- findResearchAreaMatches -------------------------------------------------------------------------------------------------
const areas = [
  { id: "r1", title: "Artificial Intelligence & Machine Learning", tag: "AI / ML" },
  { id: "r2", title: "FPGA & Hardware Acceleration", tag: "FPGA / HDL" },
];
t("research: title differing only by case and spacing is a match", findResearchAreaMatches({ title: "ARTIFICIAL INTELLIGENCE  &  MACHINE LEARNING" }, areas).map((a) => a.id).join() === "r1");
t("research: '&' vs 'and', plus punctuation, is the same title", findResearchAreaMatches({ title: "Artificial  Intelligence and Machine Learning!" }, areas).map((a) => a.id).join() === "r1");
t("research: the same words in another order is a match", findResearchAreaMatches({ title: "Machine Learning & Artificial Intelligence" }, areas).map((a) => a.id).join() === "r1");
t("research: a different title is allowed", findResearchAreaMatches({ title: "Reinforcement learning for robotics" }, areas).length === 0);
t("research: the TAG is not a duplicate signal (a shared category label)", findResearchAreaMatches({ title: "Reinforcement learning for robotics" }, [{ id: "z", title: "Machine Learning", tag: "AI / ML" }]).length === 0);
t("research: titles that only SHARE words are different areas (repo fixtures 'Area Public' / 'Area Hidden')", findResearchAreaMatches({ title: "ZZ P18 Area Hidden" }, [{ id: "z", title: "ZZ P18 Area Public" }]).length === 0);
t("research: 'Test Area' vs 'Test P9 Area Hidden' (repo fixtures) are different areas", findResearchAreaMatches({ title: "ZZ Test P9 area hidden" }, [{ id: "z", title: "ZZ Test Area" }, { id: "y", title: "ZZ Test hidden area" }]).length === 0);
t("research: a longer title that contains an existing one is a different area", findResearchAreaMatches({ title: "Machine Learning Hardware" }, [{ id: "m", title: "Machine Learning" }]).length === 0);
t("research: the record being edited is excluded", findResearchAreaMatches({ title: areas[0].title }, areas, "r1").length === 0);
t("research: an empty or punctuation-only title matches nothing", findResearchAreaMatches({ title: "" }, areas).length === 0 && findResearchAreaMatches({ title: " . " }, [{ id: "x", title: "..." }]).length === 0);

// ---- request schemas ---------------------------------------------------------------------------------------------------------
const team = { name: "N", initials: "N", role: "r", category: "MSC" };
t("createTeamMemberSchema accepts confirmDuplicate and keeps it", createTeamMemberSchema.parse({ ...team, confirmDuplicate: true }).confirmDuplicate === true);
t("createTeamMemberSchema: confirmDuplicate is optional (absent stays absent)", createTeamMemberSchema.parse(team).confirmDuplicate === undefined);
t("createTeamMemberSchema refuses a non-boolean confirmDuplicate", !createTeamMemberSchema.safeParse({ ...team, confirmDuplicate: "yes" }).success);
t("updateTeamMemberSchema: confirmDuplicate alone is still 'Nothing to update.'", !updateTeamMemberSchema.safeParse({ confirmDuplicate: true }).success);
t("updateTeamMemberSchema: a real field plus confirmDuplicate is accepted", updateTeamMemberSchema.safeParse({ name: "X", confirmDuplicate: true }).success);
t("updateOwnProfileSchema: confirmDuplicate alone is 'Nothing to update.'", !updateOwnProfileSchema.safeParse({ confirmDuplicate: true }).success && updateOwnProfileSchema.safeParse({ name: "X" }).success);
t("updatePublicationSchema / News / Research: confirmDuplicate alone is 'Nothing to update.'", ![updatePublicationSchema, updateNewsItemSchema, updateResearchAreaSchema].some((s) => s.safeParse({ confirmDuplicate: true }).success));
t("updatePublicationSchema / News / Research: a real field is accepted", updatePublicationSchema.safeParse({ title: "T" }).success && updateNewsItemSchema.safeParse({ title: "T" }).success && updateResearchAreaSchema.safeParse({ title: "T" }).success);
t("create schemas for publication, news and research accept confirmDuplicate", createPublicationSchema.safeParse({ year: 2025, title: "T", authors: "A", venue: "V", confirmDuplicate: true }).success
  && createNewsItemSchema.safeParse({ date: "May 2025", sortDate: "2025-05-01", type: "Paper", title: "T", description: "D", confirmDuplicate: true }).success
  && createResearchAreaSchema.safeParse({ title: "T", description: "D", tag: "G", confirmDuplicate: true }).success);

// ---- permission + messages ---------------------------------------------------------------------------------------------------
const admin = { id: "a", role: "ADMIN" as const }, mgr = { id: "m", role: "LAB_MANAGER" as const }, mem = { id: "u", role: "MEMBER" as const };
t("canOverrideDuplicate: admin and lab manager only", canOverrideDuplicate(admin) && canOverrideDuplicate(mgr) && !canOverrideDuplicate(mem) && !canOverrideDuplicate(null) && !canOverrideDuplicate(undefined));
t("DUPLICATE_MESSAGES: one non-empty message per kind", Object.keys(DUPLICATE_MESSAGES).length === 5 && Object.values(DUPLICATE_MESSAGES).every((m) => m.length > 20));

console.log(`${ok} duplicate-helper unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

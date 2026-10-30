/**
 * Unit checks for the SEO text and structured data of a publication's page (apps/web/src/lib/publicationSeo.ts): a PUBLISHED paper keeps its
 * year and `datePublished`; an ACCEPTED or SUBMITTED paper has neither (it must not be described as published); a legacy record with an
 * empty status keeps the behaviour it always had. Also guards that the page really uses the helper. No server, no database, no network.
 *   npm run test:unit -w apps/server
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isNotYetPublished, publicationJsonLd, publicationSeoDescription, type PublicationSeoSource } from "../../web/src/lib/publicationSeo.ts";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));

const base: PublicationSeoSource = { title: "A Paper", authors: "Ada Lovelace, Alan Turing", venue: "Journal of Tests", year: 2026, status: "" };
const with_ = (status: string): PublicationSeoSource => ({ ...base, status });
const dateOf = (p: PublicationSeoSource) => publicationJsonLd(p).datePublished;

// ---- PUBLISHED ------------------------------------------------------------------------------------------------------------------------
t("PUBLISHED: the description keeps the year", publicationSeoDescription(with_("PUBLISHED")) === "Ada Lovelace, Alan Turing — Journal of Tests (2026)");
t("PUBLISHED: datePublished is the year, as before", dateOf(with_("PUBLISHED")) === "2026");

// ---- ACCEPTED and SUBMITTED -------------------------------------------------------------------------------------------------------------
for (const s of ["ACCEPTED", "SUBMITTED"]) {
  t(`${s}: the description has no year and does not claim publication`, publicationSeoDescription(with_(s)) === "Ada Lovelace, Alan Turing — Journal of Tests" && !/2026|published/i.test(publicationSeoDescription(with_(s))));
  t(`${s}: no datePublished key at all (not even empty or undefined)`, !("datePublished" in publicationJsonLd(with_(s))));
  t(`${s}: the serialised structured data contains no 'datePublished' and no year`, !/datePublished|2026/.test(JSON.stringify(publicationJsonLd(with_(s)))));
}

// ---- legacy: empty (and unrecognised) status keeps the existing behaviour -----------------------------------------------------------------------
t("legacy empty status: the description keeps the year (unchanged behaviour)", publicationSeoDescription(with_("")) === "Ada Lovelace, Alan Turing — Journal of Tests (2026)");
t("legacy empty status: datePublished is still emitted (unchanged behaviour)", dateOf(with_("")) === "2026");
t("an unrecognised status behaves like an empty one (only ACCEPTED and SUBMITTED hide the date)", dateOf(with_("DONE")) === "2026" && dateOf(with_("accepted")) === "2026" && dateOf(with_("constructor")) === "2026");
t("isNotYetPublished is true for exactly ACCEPTED and SUBMITTED", isNotYetPublished("ACCEPTED") && isNotYetPublished("SUBMITTED") && !isNotYetPublished("PUBLISHED") && !isNotYetPublished("") && !isNotYetPublished("DONE"));

// ---- everything else in the structured data is unchanged --------------------------------------------------------------------------------------
for (const s of ["PUBLISHED", "ACCEPTED", "SUBMITTED", ""]) {
  const j = publicationJsonLd(with_(s));
  t(`status '${s || "empty"}': context, type, headline, authors and publisher are unchanged`,
    j["@context"] === "https://schema.org" && j["@type"] === "ScholarlyArticle" && j.headline === "A Paper" &&
      JSON.stringify(j.author) === JSON.stringify([{ "@type": "Person", name: "Ada Lovelace" }, { "@type": "Person", name: "Alan Turing" }]) &&
      JSON.stringify(j.publisher) === JSON.stringify({ "@type": "Organization", name: "Journal of Tests" }));
}
t("no venue: no publisher, for every status", ["PUBLISHED", "ACCEPTED", "SUBMITTED", ""].every((s) => !("publisher" in publicationJsonLd({ ...with_(s), venue: "" }))));
t("authors are split on commas, trimmed, and empty pieces dropped", JSON.stringify((publicationJsonLd({ ...base, authors: " A ,, B ," }).author as { name: string }[]).map((x) => x.name)) === JSON.stringify(["A", "B"]));

// ---- the page uses the helper (so a hand-written block cannot drift) ---------------------------------------------------------------------------
{
  const page = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "src", "pages", "PublicationDetailPage.tsx"), "utf8");
  t("page: the detail page takes both its description and its structured data from the helper", /seoDescription=\{publicationSeoDescription\(pub\)\}/.test(page) && /jsonLd=\{publicationJsonLd\(pub\)\}/.test(page));
  t("page: no hand-written datePublished or year-in-description is left on the page", !/datePublished/.test(page) && !/seoDescription=\{`/.test(page));
}

if (failures.length > 0) {
  console.error(`FAILED ${failures.length} of ${ok + failures.length}:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`publication seo: ${ok} checks passed`);

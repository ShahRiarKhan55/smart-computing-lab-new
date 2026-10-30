/**
 * SEO text and structured data for a publication's own page. Pure (no React), so the rules are unit-tested exactly as the page uses them.
 *
 * A paper that is ACCEPTED or SUBMITTED is not published yet, so it must not be described to search engines as published in a year:
 * no `datePublished`, and no year in the description. A PUBLISHED paper keeps the year. A record with an empty status (every record that
 * predates the status field, and any a person left unstated) keeps the behaviour it always had: nothing says it is unpublished, so the
 * page does not start hiding its year. An unrecognised status is treated like an empty one.
 */
export interface PublicationSeoSource {
  title: string;
  authors: string;
  venue: string;
  year: number;
  status: string;
}

/** True only for the two states that mean "not published yet". */
export const isNotYetPublished = (status: string): boolean => status === "ACCEPTED" || status === "SUBMITTED";

/** The page's meta description: "authors — venue (year)", without the year while the paper is not published. */
export function publicationSeoDescription(p: PublicationSeoSource): string {
  return isNotYetPublished(p.status) ? `${p.authors} — ${p.venue}` : `${p.authors} — ${p.venue} (${p.year})`;
}

/** The schema.org ScholarlyArticle object; `datePublished` is present only when the paper is not known to be unpublished. */
export function publicationJsonLd(p: PublicationSeoSource): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: p.title,
    author: p.authors
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ "@type": "Person", name })),
    ...(isNotYetPublished(p.status) ? {} : { datePublished: String(p.year) }),
    ...(p.venue ? { publisher: { "@type": "Organization", name: p.venue } } : {}),
  };
}

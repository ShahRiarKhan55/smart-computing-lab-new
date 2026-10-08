/** A publication found by an external source, normalised to what the review queue stores. Nothing here is public until an editor approves it. */
export interface DiscoveredWork {
  provider: "ORCID";
  /** Stable per provider: `doi:<lower-cased DOI>` when the work has a DOI (so co-authors' feeds collapse into one candidate), else `orcid:<iD>:<put-code>`. */
  externalId: string;
  /** Lower-cased bare DOI, or "". */
  doi: string;
  title: string;
  /** Comma-separated names, or "" when the source does not provide them (an editor fills it in at approval). */
  authors: string;
  year: number;
  venue: string;
  /** Canonical link: https://doi.org/<doi> when a DOI exists, else a validated http(s) URL from the source, else "". */
  url: string;
  workType: string;
}

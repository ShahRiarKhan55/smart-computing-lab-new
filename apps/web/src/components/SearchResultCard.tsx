import { Link } from "react-router-dom";
import { SEARCH_TYPE_LABELS, type SearchResult, type SearchType } from "@scl/shared";
import { Icon, type IconName } from "./Icon";
import { VisibilityBadge } from "./VisibilityField";
import { Highlight } from "./Highlight";

const TYPE_ICON: Record<SearchType, IconName> = {
  "research-area": "flask",
  project: "folder",
  group: "users",
  researcher: "user",
  publication: "file",
  news: "newspaper",
  "forum-topic": "file",
};

const CTA: Record<SearchType, string> = {
  "research-area": "View in Research",
  project: "View project",
  group: "View group",
  researcher: "View profile",
  publication: "View in Publications",
  news: "View in News",
  "forum-topic": "View topic",
};

/**
 * One compact result. The title is the only link (its accessible name is the title itself); a
 * stretched pseudo-element makes the whole card the click target, and the focus ring lands on the card.
 */
export function SearchResultCard({ result, terms }: { result: SearchResult; terms: string[] }) {
  return (
    <article className={`card card--interactive search-result search-result--${result.type}`}>
      <div className="search-result__top">
        <span className="badge badge--brand badge--upper search-result__type">
          <Icon name={TYPE_ICON[result.type]} size={12} /> {SEARCH_TYPE_LABELS[result.type]}
        </span>
        <VisibilityBadge visibility={result.visibility} />
      </div>
      <h3 className="card__title search-result__title">
        <Link to={result.href} className="search-result__link">
          <Highlight text={result.title} terms={terms} />
        </Link>
      </h3>
      {result.meta && (
        <p className="search-result__meta">
          <Highlight text={result.meta} terms={terms} />
        </p>
      )}
      {result.description && (
        <p className="search-result__desc">
          <Highlight text={result.description} terms={terms} />
        </p>
      )}
      <span className="search-result__cta" aria-hidden="true">
        {CTA[result.type]} →
      </span>
    </article>
  );
}

import { Link } from "react-router-dom";
import type { SearchResult, SearchType } from "@scl/shared";
import { Icon, type IconName } from "./Icon";
import { VisibilityBadge } from "./VisibilityField";
import { Highlight } from "./Highlight";
import { useT } from "../i18n/LocaleContext";
import { SEARCH_CTA_LABEL_KEY, SEARCH_TYPE_LABEL_KEY } from "../i18n/labels";

const TYPE_ICON: Record<SearchType, IconName> = {
  "research-area": "flask",
  project: "folder",
  group: "users",
  researcher: "user",
  publication: "file",
  news: "newspaper",
  "forum-topic": "file",
  event: "calendar",
};

/**
 * One compact result. The title is the only link (its accessible name is the title itself); a
 * stretched pseudo-element makes the whole card the click target, and the focus ring lands on the card.
 */
export function SearchResultCard({ result, terms }: { result: SearchResult; terms: string[] }) {
  const t = useT();
  return (
    <article className={`card card--interactive search-result search-result--${result.type}`}>
      <div className="search-result__top">
        <span className="badge badge--brand badge--upper search-result__type">
          <Icon name={TYPE_ICON[result.type]} size={12} /> {t(SEARCH_TYPE_LABEL_KEY[result.type])}
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
      {result.related && result.related.length > 0 && (
        <div className="search-result__related">
          <span>{t("search.relatedLabel")}</span>
          <ul className="search-result__related-list" aria-label={t("search.relatedAria")}>
            {result.related.map((r) => (
              <li key={`${r.type}-${r.id}`}>
                <Link to={r.href}>{r.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <span className="search-result__cta" aria-hidden="true">
        {t(SEARCH_CTA_LABEL_KEY[result.type])} →
      </span>
    </article>
  );
}

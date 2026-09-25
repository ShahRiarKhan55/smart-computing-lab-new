import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SEARCH_FILTERS, SEARCH_MAX_PAGE, parseSearchText, type SearchFilter } from "@scl/shared";
import { useSearchResults } from "../hooks/useSearchResults";
import { PageHeader } from "../components/PageHeader";
import { SearchForm } from "../components/SearchForm";
import { SearchResultCard } from "../components/SearchResultCard";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Icon } from "../components/Icon";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useT } from "../i18n/LocaleContext";
import { SEARCH_FILTER_LABEL_KEY } from "../i18n/labels";

const EXAMPLES = ["FPGA", "aging", "Gaussian", "半導体", "FPGA エージング"];

/** The URL is the only source of truth: ?q=&type=&page=. Unknown or invalid values fall back to the defaults. */
function readParams(params: URLSearchParams) {
  const q = (params.get("q") ?? "").trim();
  const rawType = params.get("type");
  const type: SearchFilter = SEARCH_FILTERS.includes(rawType as SearchFilter) ? (rawType as SearchFilter) : "all";
  const rawPage = params.get("page") ?? "";
  const page = /^\d{1,5}$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= SEARCH_MAX_PAGE ? Number(rawPage) : 1;
  return { q, type, page };
}

/** Builds a /search URL; page 1 and type "all" are the defaults and stay out of the URL. */
function searchUrl(q: string, type: SearchFilter = "all", page = 1) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (q && type !== "all") params.set("type", type);
  if (q && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

export function SearchPage() {
  const t = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { q, type, page } = readParams(params);
  const { data, loading, error, reload } = useSearchResults(q, type, page);
  const terms = useMemo(() => parseSearchText(q).terms, [q]);
  useDocumentTitle(q ? t("search.titleWithQuery", { query: q }) : t("search.pageTitle"));

  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 0;
  const first = (page - 1) * (data?.pagination.limit ?? 20) + 1;
  const scrollToStatus = () => document.getElementById("search-status")?.scrollIntoView({ block: "start" });

  const statusText = () => {
    if (!data) return "";
    const showingSuffix = totalPages > 1 && data.results.length > 0 ? t("search.showingSuffix", { first, last: first + data.results.length - 1 }) : "";
    if (type !== "all") {
      return t(total === 1 ? "search.statusTypeOne" : "search.statusTypeOther", { count: total, type: t(SEARCH_FILTER_LABEL_KEY[type]), query: data.query }) + showingSuffix;
    }
    return t(total === 1 ? "search.statusAllOne" : "search.statusAllOther", { count: total, query: data.query }) + showingSuffix;
  };

  return (
    <>
      <PageHeader eyebrow={t("search.pageTitle")} title={t("search.pageTitle")} description={t("search.pageDescription")} />

      <div className="container search-page">
        <SearchForm
          variant="page"
          inputId="search-page-input"
          label={t("search.searchLanding")}
          placeholder={t("search.placeholderHint")}
          value={q}
          onSearch={(next) => navigate(searchUrl(next, type))}
        />

        {!q && (
          <section className="search-landing" aria-labelledby="search-landing-title">
            <h2 id="search-landing-title" className="search-landing__title">
              {t("search.searchLanding")}
            </h2>
            <p>{t("search.introText")}</p>
            <p className="search-landing__try">
              {t("search.tryPrefix")}{" "}
              {EXAMPLES.map((example) => (
                <Link key={example} className="search-landing__example" to={searchUrl(example)}>
                  {example}
                </Link>
              ))}
            </p>
          </section>
        )}

        {q && (
          <>
            <div className="chips search-filters" role="group" aria-label={t("search.filterByTypeAria")}>
              {SEARCH_FILTERS.map((filter) => (
                <Link key={filter} to={searchUrl(q, filter)} className={`chip${type === filter ? " active" : ""}`} aria-current={type === filter ? "true" : undefined}>
                  {t(SEARCH_FILTER_LABEL_KEY[filter])}
                  {data && <span className="chip__count">{data.counts[filter] ?? 0}</span>}
                </Link>
              ))}
            </div>

            <div className="search-region" aria-busy={loading}>
              <p id="search-status" className="search-status" role="status" aria-live="polite">
                {error ? "" : !data ? t("search.loading") : statusText()}
              </p>

              {error && <ErrorState message={error} onRetry={reload} retryClassName="search-retry" />}

              {!error && !data && (
                <div className="search-skeleton" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              )}

              {!error && data && (
                <>
                  {total === 0 && (
                    <EmptyState className="search-empty" title={t("search.noResultsQuoted", { query: data.query })}>
                      <ul>
                        <li>{t("search.tryBroader")}</li>
                        <li>{t("search.checkSpelling")}</li>
                        {type !== "all" && data.counts.all > 0 ? (
                          <li>
                            <Link to={searchUrl(q)}>{t("search.searchAllCategories")}</Link> ({t(data.counts.all === 1 ? "search.resultCountOne" : "search.resultCountOther", { count: data.counts.all })} {t("search.elsewhere")}).
                          </li>
                        ) : (
                          <li>{t("search.searchAllCategoriesHint")}</li>
                        )}
                      </ul>
                      {type !== "all" && data.counts.all > 0 && (
                        <>
                          <p className="text-sm text-muted">{t("search.otherMatches")}</p>
                          <div className="chips search-other">
                            {SEARCH_FILTERS.filter((f) => f !== "all" && f !== type && (data.counts[f] ?? 0) > 0).map((f) => (
                              <Link key={f} to={searchUrl(q, f)} className="chip">
                                {t("search.otherMatchItem", { type: t(SEARCH_FILTER_LABEL_KEY[f]), count: data.counts[f] ?? 0 })}
                              </Link>
                            ))}
                          </div>
                        </>
                      )}
                    </EmptyState>
                  )}

                  {total > 0 && data.results.length === 0 && (
                    <EmptyState className="search-empty" title={t("search.noPageFor", { page })}>
                      <Link to={searchUrl(q, type)}>{t("search.backToFirstPage")}</Link>
                    </EmptyState>
                  )}

                  {data.results.length > 0 && <h2 className="sr-only">{t("search.resultsHeadingSr")}</h2>}
                  {data.results.length > 0 && (
                    <ol className={`search-results${loading ? " is-loading" : ""}`}>
                      {data.results.map((result) => (
                        <li key={`${result.type}-${result.id}`}>
                          <SearchResultCard result={result} terms={terms} />
                        </li>
                      ))}
                    </ol>
                  )}

                  {totalPages > 1 && data.results.length > 0 && (
                    <nav className="search-pager" aria-label={t("search.resultPagesAria")}>
                      {page > 1 ? (
                        <Link className="btn btn--secondary btn--sm" to={searchUrl(q, type, page - 1)} onClick={scrollToStatus} rel="prev">
                          <Icon name="arrow-left" size={14} /> {t("common.previous")}
                        </Link>
                      ) : (
                        <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
                          <Icon name="arrow-left" size={14} /> {t("common.previous")}
                        </span>
                      )}
                      <span className="search-pager__pos">{t("common.pageOf", { page, total: totalPages })}</span>
                      {page < totalPages ? (
                        <Link className="btn btn--secondary btn--sm" to={searchUrl(q, type, page + 1)} onClick={scrollToStatus} rel="next">
                          {t("common.next")} <Icon name="arrow-right" size={14} />
                        </Link>
                      ) : (
                        <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
                          {t("common.next")} <Icon name="arrow-right" size={14} />
                        </span>
                      )}
                    </nav>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

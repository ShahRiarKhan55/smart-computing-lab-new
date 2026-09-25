import type { LabEvent, NewsItem, Publication } from "@scl/shared";
import { EmptyState } from "./EmptyState";
import { EventCard } from "./EventCard";
import { NewsCard } from "./NewsCard";
import { PublicationItem } from "./PublicationItem";
import { SectionHeader } from "./SectionHeader";
import { useT } from "../i18n/LocaleContext";

interface RelatedOutputsProps {
  /** Prefix for the section heading ids ("area" -> "area-pubs"), so each page keeps unique ids. */
  idPrefix: string;
  publications: Publication[];
  news: NewsItem[];
  events: LabEvent[];
  /** One line saying WHERE these come from (e.g. "…belong to the projects listed above"). */
  note?: string;
}

/**
 * Publications, news and events a research area or group gathers from its projects. Every list is
 * already filtered to what the viewer may see by the API; this only renders. Read-only on purpose:
 * these records are edited on their own pages, under their own permissions.
 */
export function RelatedOutputs({ idPrefix, publications, news, events, note }: RelatedOutputsProps) {
  const t = useT();
  return (
    <>
      <section className="detail-section" aria-labelledby={`${idPrefix}-pubs`}>
        <SectionHeader compact id={`${idPrefix}-pubs`} title={t("rs.pubsHeading", { count: publications.length })} description={note} />
        {publications.length === 0 ? (
          <EmptyState title={t("rs.noPubs")} compact />
        ) : (
          <div className="pub-list">
            {publications.map((p) => (
              <PublicationItem key={p.id} publication={p} canEdit={false} canDelete={false} />
            ))}
          </div>
        )}
      </section>

      <section className="detail-section" aria-labelledby={`${idPrefix}-news`}>
        <SectionHeader compact id={`${idPrefix}-news`} title={t("rs.newsHeading", { count: news.length })} />
        {news.length === 0 ? (
          <EmptyState title={t("rs.noNews")} compact />
        ) : (
          <div className="grid">
            {news.map((n) => (
              <NewsCard key={n.id} item={n} />
            ))}
          </div>
        )}
      </section>

      <section className="detail-section" aria-labelledby={`${idPrefix}-events`}>
        <SectionHeader compact id={`${idPrefix}-events`} title={t("rs.eventsHeading", { count: events.length })} />
        {events.length === 0 ? (
          <EmptyState title={t("rs.noEvents")} compact />
        ) : (
          <div className="grid">
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

import { Link } from "react-router-dom";
import type { AdminCommunityResponse } from "@scl/shared";
import { useApiResource } from "../../hooks/useApiResource";
import { useLocale, useT } from "../../i18n/LocaleContext";
import { dictLabel } from "../../i18n/labels";
import { formatDate, formatNumber } from "../../lib/format";
import { Badge } from "../../components/Badge";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { LoadingState } from "../../components/LoadingState";
import { SectionHeader } from "../../components/SectionHeader";

/**
 * A look at community activity. Deliberately not a second forum: no post text is loaded, nothing here
 * edits anyone's words, and moderation (hide / lock / pin / move) stays on the forum's own pages under
 * the existing `canModerate` rule.
 */
export function AdminCommunityPage() {
  const t = useT();
  const { locale } = useLocale();
  const { data, loading, error, reload } = useApiResource<AdminCommunityResponse>("/admin/community");
  const n = (v: number) => formatNumber(v, locale);

  if (error) return <ErrorState message={t("adm.loadError")} onRetry={reload} />;
  if (loading || !data) return <LoadingState label={t("adm.loading")} variant="list" />;

  return (
    <>
      <p className="text-muted admin-note">{t("adm.com.intro")}</p>

      <section className="detail-section" aria-labelledby="com-categories">
        <SectionHeader compact id="com-categories" title={t("adm.com.categories")} />
        {data.categories.length === 0 ? (
          <EmptyState title={t("adm.com.noCategories")} compact />
        ) : (
          <ul className="admin-list">
            {data.categories.map((c) => (
              <li key={c.id} className="admin-row">
                <div className="admin-row__main">
                  <div className="admin-row__title">{c.name}</div>
                  <div className="admin-row__meta">
                    <Badge variant={c.visibility === "PUBLIC" ? "brand" : "warn"}>{dictLabel(t, "adm.vis.", c.visibility)}</Badge>
                    {c.locked && <Badge>{t("adm.com.locked")}</Badge>}
                    <span>
                      {t("adm.com.topics")}: {n(c.topics)}
                    </span>
                    <span>
                      {t("adm.com.hiddenTopics")}: {n(c.hiddenTopics)}
                    </span>
                    <span>
                      {t("adm.com.comments")}: {n(c.comments)}
                    </span>
                    <span>
                      {t("adm.com.hiddenComments")}: {n(c.hiddenComments)}
                    </span>
                  </div>
                </div>
                <div className="admin-row__actions">
                  <Link className="btn btn--ghost btn--sm" to={`/community/forum/category/${c.slug}`}>
                    {t("adm.com.openForum")} <Icon name="arrow-right" size={14} />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-section" aria-labelledby="com-hidden">
        <SectionHeader compact id="com-hidden" title={t("adm.com.hiddenHeading")} />
        {data.hiddenTopics.length === 0 ? (
          <EmptyState title={t("adm.com.noHidden")} compact />
        ) : (
          <ul className="admin-list">
            {data.hiddenTopics.map((p) => (
              <li key={p.id} className="admin-row">
                <div className="admin-row__main">
                  <div className="admin-row__title">{p.title}</div>
                  <div className="admin-row__meta">
                    <span>{p.categoryName}</span>
                    {p.author && <span>{t("adm.com.by", { name: p.author })}</span>}
                    <span>{formatDate(p.createdAt, locale)}</span>
                  </div>
                </div>
                <div className="admin-row__actions">
                  <Link className="btn btn--secondary btn--sm" to={p.href}>
                    {t("adm.com.review")} <Icon name="arrow-right" size={14} />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-section" aria-labelledby="com-related">
        <SectionHeader compact id="com-related" title={t("adm.com.related")} />
        <div className="tile-grid">
          <Link to="/community/forum" className="tile-link">
            <Icon name="message" size={18} /> {t("adm.com.openForum")}
          </Link>
          <Link to="/admin/events" className="tile-link">
            <Icon name="calendar" size={18} /> {t("adm.com.manageEvents")} · {t("adm.com.eventsCount", { n: n(data.events) })}
          </Link>
          <Link to="/admin/files" className="tile-link">
            <Icon name="image" size={18} /> {t("adm.com.openGallery")} · {t("adm.com.galleryCount", { n: n(data.galleryItems) })}
          </Link>
        </div>
      </section>
    </>
  );
}

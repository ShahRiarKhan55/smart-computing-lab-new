import { Link } from "react-router-dom";
import type { AdminCount, AdminOverview, TranslationKey } from "@scl/shared";
import { useApiResource } from "../../hooks/useApiResource";
import { useLocale, useT } from "../../i18n/LocaleContext";
import { formatNumber } from "../../lib/format";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { SectionHeader } from "../../components/SectionHeader";
import { StatCard } from "../../components/StatCard";

function CountCard({ to, label, count, extra }: { to: string; label: string; count: AdminCount; extra?: string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <Link to={to} className="admin-count">
      <span className="admin-count__value">{formatNumber(count.total, locale)}</span>
      <span className="admin-count__label">{label}</span>
      <span className="admin-count__detail">{t("adm.ov.breakdown", { public: formatNumber(count.public, locale), labOnly: formatNumber(count.labOnly, locale) })}</span>
      {extra && <span className="admin-count__detail">{extra}</span>}
    </Link>
  );
}

/** Real counts from the database, nothing else: no analytics, and nothing about private messages or notifications. */
export function AdminOverviewPage() {
  const t = useT();
  const { locale } = useLocale();
  const { data, loading, error, reload } = useApiResource<AdminOverview>("/admin/overview");
  const n = (v: number) => formatNumber(v, locale);

  if (error) return <ErrorState message={t("adm.loadError")} onRetry={reload} />;
  if (loading || !data) return <LoadingState label={t("adm.loading")} variant="cards" />;

  const plain = (key: TranslationKey) => t(key);
  return (
    <>
      {data.accounts && (
        <section className="detail-section" aria-labelledby="ov-people">
          <SectionHeader compact id="ov-people" title={t("adm.ov.people")} />
          <div className="stat-grid">
            <Link to="/admin/people" className="admin-count">
              <span className="admin-count__value">{n(data.accounts.total)}</span>
              <span className="admin-count__label">{plain("adm.ov.accounts")}</span>
              <span className="admin-count__detail">
                {t("adm.ov.accountsBreakdown", { admins: n(data.accounts.admins), managers: n(data.accounts.managers), members: n(data.accounts.members) })}
              </span>
              <span className="admin-count__detail">{t("adm.ov.noLogin", { n: n(data.accounts.profilesWithoutLogin) })}</span>
            </Link>
            <StatCard value={data.teamMembers} label={plain("adm.ov.teamMembers")} />
          </div>
        </section>
      )}

      <section className="detail-section" aria-labelledby="ov-content">
        <SectionHeader compact id="ov-content" title={t("adm.ov.content")} />
        <div className="stat-grid">
          {!data.accounts && <StatCard value={data.teamMembers} label={plain("adm.ov.teamMembers")} />}
          <CountCard to="/admin/content?type=research-area" label={plain("adm.ov.researchAreas")} count={data.researchAreas} />
          <CountCard to="/admin/content?type=project" label={plain("adm.ov.projects")} count={data.projects} />
          <CountCard to="/admin/content?type=group" label={plain("adm.ov.groups")} count={data.groups} />
          <CountCard to="/admin/content?type=publication" label={plain("adm.ov.publications")} count={data.publications} />
          <CountCard to="/admin/content?type=news" label={plain("adm.ov.news")} count={data.news} />
        </div>
      </section>

      <section className="detail-section" aria-labelledby="ov-community">
        <SectionHeader compact id="ov-community" title={t("adm.ov.community")} />
        <div className="stat-grid">
          <CountCard to="/admin/events" label={plain("adm.ov.events")} count={data.events} extra={t("adm.ov.upcoming", { n: n(data.events.upcoming) })} />
          <CountCard to="/admin/community" label={plain("adm.ov.forumCategories")} count={data.forumCategories} />
          <StatCard value={data.forumTopics} label={plain("adm.ov.forumTopics")} />
          <CountCard to="/admin/files" label={plain("adm.ov.galleryItems")} count={data.galleryItems} />
        </div>
      </section>

      <section className="detail-section" aria-labelledby="ov-localization">
        <SectionHeader compact id="ov-localization" title={t("adm.ov.localization")} />
        <div className="stat-grid">
          <StatCard value={data.translations.overrides} label={plain("adm.ov.overrides")} />
        </div>
      </section>

      <p className="text-muted admin-note">{t("adm.ov.privacyNote")}</p>
    </>
  );
}

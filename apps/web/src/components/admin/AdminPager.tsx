import type { AdminPagination } from "@scl/shared";
import { useT } from "../../i18n/LocaleContext";
import { formatNumber } from "../../lib/format";
import { useLocale } from "../../i18n/LocaleContext";

interface AdminPagerProps {
  pagination: AdminPagination;
  onPage: (page: number) => void;
}

/** Previous / Next with "Page x of y". Renders nothing when everything fits on one page. */
export function AdminPager({ pagination, onPage }: AdminPagerProps) {
  const t = useT();
  const { locale } = useLocale();
  const { page, totalPages } = pagination;
  if (totalPages <= 1) return null;
  return (
    <nav className="admin-pager" aria-label={t("adm.pager.label")}>
      <button className="btn btn--secondary btn--sm" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t("adm.pager.prev")}
      </button>
      <span className="admin-pager__status">{t("adm.pager.status", { page: formatNumber(page, locale), pages: formatNumber(totalPages, locale) })}</span>
      <button className="btn btn--secondary btn--sm" type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        {t("adm.pager.next")}
      </button>
    </nav>
  );
}

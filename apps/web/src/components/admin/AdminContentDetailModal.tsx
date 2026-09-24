import { Link } from "react-router-dom";
import type { AdminContentDetail, AdminContentRow } from "@scl/shared";
import { Modal } from "../Modal";
import { Icon } from "../Icon";
import { ErrorState } from "../ErrorState";
import { LoadingState } from "../LoadingState";
import { useApiResource } from "../../hooks/useApiResource";
import { useLocale, useT } from "../../i18n/LocaleContext";
import { dictLabel } from "../../i18n/labels";
import { formatDate, formatNumber } from "../../lib/format";

interface Props {
  row: AdminContentRow | null;
  onClose: () => void;
}

/** What a record is connected to and how much of it is translated. Read-only: editing happens on the record's own page, under its own permissions. */
export function AdminContentDetailModal({ row, onClose }: Props) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <Modal open={row !== null} onClose={onClose} title={row ? row.title : t("adm.detail.title")}>
      {row && <Body row={row} locale={locale} onClose={onClose} />}
    </Modal>
  );
}

function Body({ row, locale, onClose }: { row: AdminContentRow; locale: "en" | "ja"; onClose: () => void }) {
  const t = useT();
  const { data, loading, error, reload } = useApiResource<AdminContentDetail>(`/admin/content/${row.type}/${row.id}`);
  return (
    <div className="admin-detail">
      <p className="admin-detail__dates">
        {t("adm.detail.created", { date: formatDate(row.createdAt, locale) })} · {t("adm.detail.updated", { date: formatDate(row.updatedAt, locale) })}
      </p>
      {loading && <LoadingState label={t("adm.loading")} variant="text" count={3} />}
      {error && <ErrorState message={t("adm.detail.loadError")} onRetry={reload} />}
      {data && (
        <>
          <h3 className="admin-detail__heading">{t("adm.detail.relations")}</h3>
          {data.relations.every((r) => r.count === 0) ? (
            <p className="text-muted">{t("adm.detail.noRelations")}</p>
          ) : (
            <ul className="admin-detail__list">
              {data.relations
                .filter((r) => r.count > 0)
                .map((r) => (
                  <li key={r.key}>
                    <span>{dictLabel(t, "adm.rel.", r.key)}</span>
                    <strong>{formatNumber(r.count, locale)}</strong>
                  </li>
                ))}
            </ul>
          )}
          {data.translations.length > 0 && (
            <>
              <h3 className="admin-detail__heading">{t("adm.detail.translations")}</h3>
              <ul className="admin-detail__list">
                {data.translations.map((tr) => (
                  <li key={tr.field}>
                    <span>{dictLabel(t, "adm.field.", tr.field)}</span>
                    <span className={tr.hasOverride ? "badge badge--brand" : "badge"}>{tr.hasOverride ? t("adm.detail.hasOverride") : t("adm.detail.noOverride")}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <p className="text-muted admin-detail__hint">{t("adm.detail.editHint")}</p>
      <div className="modal__actions">
        <button className="btn btn--secondary" type="button" onClick={onClose}>
          {t("common.close")}
        </button>
        <Link className="btn btn--primary" to={row.href}>
          {t("adm.detail.openPublic")} <Icon name="arrow-right" size={14} />
        </Link>
      </div>
    </div>
  );
}

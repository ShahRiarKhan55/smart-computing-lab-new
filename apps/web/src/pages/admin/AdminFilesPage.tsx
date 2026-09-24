import { useMemo, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { GALLERY_CATEGORIES, type AdminFilesResponse, type GalleryCategory } from "@scl/shared";
import { useApiResource } from "../../hooks/useApiResource";
import { useLocale, useT } from "../../i18n/LocaleContext";
import { dictLabel, GALLERY_CATEGORY_LABEL_KEY } from "../../i18n/labels";
import { formatBytes, formatDate, formatNumber } from "../../lib/format";
import { AdminPager } from "../../components/admin/AdminPager";
import { Badge } from "../../components/Badge";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { LoadingState } from "../../components/LoadingState";

const PARAMS = ["q", "visibility", "category"] as const;

/**
 * Gallery file METADATA for managers. The response never contains a storage key or path, and the bytes
 * are not reachable from here: they stay behind /api/files/:id and that route's own access check.
 */
export function AdminFilesPage() {
  const t = useT();
  const { locale } = useLocale();
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of PARAMS) if (sp.get(k)) p.set(k, sp.get(k) as string);
    if (page > 1) p.set("page", String(page));
    return p.toString();
  }, [sp, page]);
  const { data, loading, error, reload } = useApiResource<AdminFilesResponse>(`/admin/files?${apiQuery}`);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const k of PARAMS) {
      const v = form.get(k);
      if (typeof v === "string" && v.trim()) next.set(k, v.trim());
    }
    setSp(next);
  }

  const val = (k: (typeof PARAMS)[number]) => sp.get(k) ?? "";
  return (
    <>
      <p className="text-muted admin-note">{t("adm.files.intro")}</p>
      <form key={sp.toString()} className="admin-filters" onSubmit={onSubmit} role="search" aria-label={t("adm.f.filters")}>
        <div className="form-group admin-filters__wide">
          <label htmlFor="af-q">{t("adm.f.search")}</label>
          <input id="af-q" name="q" type="search" defaultValue={val("q")} maxLength={100} placeholder={t("adm.f.searchPlaceholder")} />
        </div>
        <div className="form-group">
          <label htmlFor="af-visibility">{t("adm.f.visibility")}</label>
          <select id="af-visibility" name="visibility" defaultValue={val("visibility")}>
            <option value="">{t("adm.f.any")}</option>
            <option value="PUBLIC">{t("adm.vis.PUBLIC")}</option>
            <option value="LAB_ONLY">{t("adm.vis.LAB_ONLY")}</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="af-category">{t("adm.files.category")}</label>
          <select id="af-category" name="category" defaultValue={val("category")}>
            <option value="">{t("adm.f.any")}</option>
            {GALLERY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(GALLERY_CATEGORY_LABEL_KEY[c])}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-filters__actions">
          <button className="btn btn--primary btn--sm" type="submit">
            {t("adm.f.apply")}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setSp(new URLSearchParams())}>
            {t("adm.f.reset")}
          </button>
        </div>
      </form>

      <div role="status" aria-live="polite" className="admin-status">
        {data && !loading && <span className="text-muted">{t("adm.list.total", { n: formatNumber(data.pagination.total, locale) })}</span>}
      </div>
      {error && <ErrorState message={t("adm.list.loadError")} onRetry={reload} />}
      {loading && !data && <LoadingState label={t("adm.loading")} variant="list" />}
      {data && data.rows.length === 0 && <EmptyState title={t("adm.files.empty")} compact />}

      {data && data.rows.length > 0 && (
        <ul className="admin-list" aria-label={t("adm.list.aria")} aria-busy={loading}>
          {data.rows.map((f) => (
            <li key={f.id} className="admin-row">
              <div className="admin-row__main">
                <div className="admin-row__title">{f.originalName}</div>
                <div className="admin-row__sub">{f.caption || t("adm.files.noCaption")}</div>
                <div className="admin-row__meta">
                  <Badge variant={f.visibility === "PUBLIC" ? "brand" : "warn"}>{dictLabel(t, "adm.vis.", f.visibility)}</Badge>
                  <Badge>{f.category in GALLERY_CATEGORY_LABEL_KEY ? t(GALLERY_CATEGORY_LABEL_KEY[f.category as GalleryCategory]) : f.category}</Badge>
                  <span>
                    {f.mimeType} · {formatBytes(f.sizeBytes, locale)}
                  </span>
                  <span>{f.uploadedBy ? t("adm.files.by", { name: f.uploadedBy.name }) : t("adm.files.unknownUploader")}</span>
                  {f.project && <span>{t("adm.files.project", { title: f.project.title })}</span>}
                  <span>{t("adm.files.uploaded", { date: formatDate(f.createdAt, locale) })}</span>
                </div>
              </div>
              <div className="admin-row__actions">
                <Link className="btn btn--ghost btn--sm" to="/gallery">
                  {t("adm.files.openGallery")} <Icon name="arrow-right" size={14} />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && <AdminPager pagination={data.pagination} onPage={(p) => { const next = new URLSearchParams(sp); if (p > 1) next.set("page", String(p)); else next.delete("page"); setSp(next); }} />}
    </>
  );
}

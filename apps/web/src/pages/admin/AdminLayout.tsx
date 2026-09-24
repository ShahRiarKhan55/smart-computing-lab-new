import { NavLink, Outlet } from "react-router-dom";
import type { TranslationKey } from "@scl/shared";
import { usePolicy } from "../../auth/usePolicy";
import { useT } from "../../i18n/LocaleContext";
import { PageHeader } from "../../components/PageHeader";

interface Section {
  to: string;
  labelKey: TranslationKey;
  end?: boolean;
  /** Cosmetic: the API re-checks every request, and /admin/people has its own route guard. */
  adminOnly?: boolean;
}

const SECTIONS: Section[] = [
  { to: "/admin", labelKey: "adm.nav.overview", end: true },
  { to: "/admin/people", labelKey: "adm.nav.people", adminOnly: true },
  { to: "/admin/content", labelKey: "adm.nav.content" },
  { to: "/admin/events", labelKey: "adm.nav.events" },
  { to: "/admin/community", labelKey: "adm.nav.community" },
  { to: "/admin/files", labelKey: "adm.nav.files" },
  { to: "/admin/translations", labelKey: "adm.nav.translations" },
  { to: "/admin/audit", labelKey: "adm.nav.audit" },
];

/**
 * The Admin Dashboard shell: one header and a section nav shared by every admin page. The admin area
 * is a management view over the ordinary content APIs — the same pages, permissions and audit trail —
 * so it uses the ordinary design system (PageHeader, chips, cards) rather than a separate look.
 */
export function AdminLayout() {
  const t = useT();
  const policy = usePolicy();
  return (
    <>
      <PageHeader eyebrow={t("adm.eyebrow")} title={t("admin.pageTitle")} description={t("adm.pageDescription")} />
      <div className="container admin-shell">
        <nav aria-label={t("adm.navLabel")}>
          <ul className="chips admin-nav">
            {SECTIONS.filter((s) => !s.adminOnly || policy.canManageUsers).map((s) => (
              <li key={s.to}>
                <NavLink to={s.to} end={s.end} className={({ isActive }) => `chip${isActive ? " active" : ""}`}>
                  {t(s.labelKey)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <Outlet />
      </div>
    </>
  );
}

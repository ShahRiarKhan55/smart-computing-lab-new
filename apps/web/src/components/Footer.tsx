import { NavLink } from "react-router-dom";
import { MAIN_NAV, isGroup } from "./navConfig";
import { useT } from "../i18n/LocaleContext";

// The footer repeats the public destinations from the same source as the header, so the two never drift.
const RESEARCH = MAIN_NAV.filter(isGroup).find((g) => g.id === "research");
const PEOPLE = MAIN_NAV.filter(isGroup).find((g) => g.id === "people");

export function Footer() {
  const t = useT();
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          {/* The lab's own name is never translated (no official Japanese name exists to use). */}
          <div className="footer__logo">Smart Computing Lab</div>
          <p className="footer__tagline">{t("footer.tagline")}</p>
        </div>
        <nav aria-label={t("nav.footerAria", { group: t("footer.researchHeading") })}>
          <h2 className="footer__heading">{t("footer.researchHeading")}</h2>
          <ul className="footer__links">
            {RESEARCH?.items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to}>{t(item.labelKey)}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t("nav.footerAria", { group: t("footer.peopleHeading") })}>
          <h2 className="footer__heading">{t("footer.peopleHeading")}</h2>
          <ul className="footer__links">
            {PEOPLE?.items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to}>{t(item.labelKey)}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t("nav.footerAria", { group: t("footer.labHeading") })}>
          <h2 className="footer__heading">{t("footer.labHeading")}</h2>
          <ul className="footer__links">
            <li>
              <NavLink to="/contact">{t("nav.contact")}</NavLink>
            </li>
            <li>
              <NavLink to="/search">{t("search.pageTitle")}</NavLink>
            </li>
          </ul>
        </nav>
        <div className="footer__copy">{t("footer.copyright", { year: new Date().getFullYear() })}</div>
      </div>
    </footer>
  );
}

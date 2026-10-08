import { NavLink } from "react-router-dom";
import { MAIN_NAV, isGroup } from "./navConfig";
import { useT } from "../i18n/LocaleContext";
import { useSiteConfig } from "../lib/siteConfig";

// The footer repeats the public destinations from the same source as the header, so the two never drift.
const RESEARCH = MAIN_NAV.filter(isGroup).find((g) => g.id === "research");
const PEOPLE = MAIN_NAV.filter(isGroup).find((g) => g.id === "people");
const COMMUNITY = MAIN_NAV.filter(isGroup).find((g) => g.id === "community");

export function Footer() {
  const t = useT();
  const { portalUrl } = useSiteConfig();
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
        <nav aria-label={t("nav.footerAria", { group: t("footer.communityHeading") })}>
          <h2 className="footer__heading">{t("footer.communityHeading")}</h2>
          <ul className="footer__links">
            {COMMUNITY?.items.map((item) => (
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
              <NavLink to="/alumni">{t("footer.alumni")}</NavLink>
            </li>
            <li>
              <NavLink to="/search">{t("search.pageTitle")}</NavLink>
            </li>
            <li>
              <NavLink to="/docs">{t("docs.index.title")}</NavLink>
            </li>
            <li>
              <NavLink to="/copyright">{t("footer.copyrightLink")}</NavLink>
            </li>
            {portalUrl && (
              <li>
                <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                  {t("footer.portal")}
                </a>
              </li>
            )}
          </ul>
        </nav>
        <div className="footer__copy">
          <p className="footer__disclaimer">{t("footer.disclaimerShort")}</p>
          <p className="footer__disclaimer">
            <NavLink to="/copyright">{t("footer.copyrightLink")}</NavLink>
          </p>
          {t("footer.copyright", { year: new Date().getFullYear() })}
        </div>
      </div>
    </footer>
  );
}

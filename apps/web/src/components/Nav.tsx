import { useRef, useState, type KeyboardEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { usePolicy } from "../auth/usePolicy";
import { useT } from "../i18n/LocaleContext";
import { NavGroup } from "./NavGroup";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SearchForm } from "./SearchForm";
import { ACCOUNT_NAV, LOGIN_LINK, MAIN_NAV, groupContaining, isGroup, resolveGroup, resolveNav } from "./navConfig";

function linkClassName({ isActive }: { isActive: boolean }) {
  return isActive ? "active" : undefined;
}

/**
 * The site header. What it shows lives in navConfig.ts; this renders it: grouped dropdowns on
 * desktop, the same list as a hamburger menu with expandable sections at tablet/phone widths.
 * Showing or hiding a link here is a courtesy — routes and the API enforce access on their own.
 */
export function Nav() {
  const { user, loading, logout } = useAuth();
  const policy = usePolicy();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false); // the hamburger menu
  const [openGroup, setOpenGroup] = useState<string | null>(null); // at most one dropdown / section
  const [seenKey, setSeenKey] = useState(location.key);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // Any navigation (a link, back/forward, a search) folds every menu away. Adjusted while
  // rendering, the pattern React recommends over an effect for state that follows a value.
  if (seenKey !== location.key) {
    setSeenKey(location.key);
    setMenuOpen(false);
    setOpenGroup(null);
  }

  const ctx = { signedIn: !!user, canManageUsers: policy.canManageUsers, canAccessAdmin: policy.canAccessAdmin };
  const entries = resolveNav(MAIN_NAV, ctx);
  const account = user ? resolveGroup(ACCOUNT_NAV, ctx) : null;
  const activeGroup = groupContaining(account ? [...entries, account] : entries, location.pathname);

  const setGroupOpen = (id: string) => (open: boolean) =>
    setOpenGroup((current) => (open ? id : current === id ? null : current));

  async function handleLogout() {
    setMenuOpen(false);
    setOpenGroup(null);
    await logout();
    navigate("/");
  }

  function toggleMenu() {
    // Opening the phone menu expands the section you are in, so the current page is in view.
    setOpenGroup(menuOpen ? null : activeGroup);
    setMenuOpen(!menuOpen);
  }

  // Escape closes an open dropdown first (NavGroup stops it there), then the hamburger menu.
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape" && menuOpen) {
      setMenuOpen(false);
      setOpenGroup(null);
      hamburgerRef.current?.focus();
    }
  }

  return (
    <nav className="nav" aria-label={t("nav.mainLabel")} data-auth={loading ? "loading" : "ready"} onKeyDown={onKeyDown}>
      <div className="nav__logo">
        <NavLink to="/" aria-label={t("nav.homeAria")}>
          SCL<span>_</span>
        </NavLink>
      </div>
      <ul className={`nav__links${menuOpen ? " open" : ""}`} id="navLinks">
        <li className="nav__search">
          <SearchForm
            variant="nav"
            inputId="nav-search-input"
            label={t("nav.searchSite")}
            placeholder={t("nav.searchPlaceholder")}
            clearOnSubmit
            onSearch={(q) => {
              setMenuOpen(false);
              navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
            }}
          />
        </li>
        {entries.map((entry) =>
          isGroup(entry) ? (
            <NavGroup
              key={entry.id}
              group={entry}
              open={openGroup === entry.id}
              active={activeGroup === entry.id}
              onOpenChange={setGroupOpen(entry.id)}
            />
          ) : (
            <li key={entry.to}>
              <NavLink to={entry.to} end={entry.end} className={linkClassName}>
                {t(entry.labelKey)}
              </NavLink>
            </li>
          ),
        )}
        <LanguageSwitcher />
        {loading ? (
          // Until the session is known the account slot is held empty: no flash of "Log in" for someone who is signed in.
          <li className="nav__account nav__account--pending" aria-hidden="true" />
        ) : account ? (
          <NavGroup
            group={account}
            open={openGroup === account.id}
            active={activeGroup === account.id}
            alignEnd
            className="nav__account"
            onOpenChange={setGroupOpen(account.id)}
          >
            <li className="nav__action">
              <button type="button" onClick={handleLogout}>
                {t("nav.logout")}
              </button>
            </li>
          </NavGroup>
        ) : (
          <li className="nav__account">
            <NavLink to={LOGIN_LINK.to} className={linkClassName}>
              {t(LOGIN_LINK.labelKey)}
            </NavLink>
          </li>
        )}
      </ul>
      <button
        ref={hamburgerRef}
        className="nav__hamburger"
        aria-label={t("nav.toggleMenu")}
        aria-expanded={menuOpen}
        aria-controls="navLinks"
        type="button"
        onClick={toggleMenu}
      >
        <span></span>
        <span></span>
        <span></span>
      </button>
    </nav>
  );
}

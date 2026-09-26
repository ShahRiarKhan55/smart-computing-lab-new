import { matchPath } from "react-router-dom";
import type { TranslationKey } from "@scl/shared";

/**
 * The header's information architecture, as data. Nav.tsx only renders it.
 *
 * Adding a destination = one entry here. Only routes that exist in App.tsx belong in this file:
 * a future feature gets its entry in the same commit as its route. "Community" holds Forum
 * (Phase 11); Messages and Notifications live in the signed-in Account group (Phase 12) — both
 * are private, so neither is ever shown to a guest.
 *
 * `when` only decides whether a link is SHOWN. It is a courtesy, never protection: every
 * protected route re-checks the visitor (ProtectedRoute in the browser, requireCan/requireAuth
 * on the API), so a hidden link is not a locked door and a shown link is not an open one.
 */
export interface NavContext {
  signedIn: boolean;
  /** From usePolicy(): the same central policy the API enforces. */
  canManageUsers: boolean;
  /** Managers and admins reach the admin area (Phase 17); the API re-checks every admin request. */
  canAccessAdmin: boolean;
}

export interface NavLinkDef {
  to: string;
  /** A UI dictionary key (packages/shared/src/i18n), translated at render time by Nav.tsx/NavGroup.tsx
   * — labels are still data here, just localized data, so this stays a Phase 10.1 "navConfig only" change. */
  labelKey: TranslationKey;
  /** Active only on the exact path (otherwise /team/:id keeps "Team" active). */
  end?: boolean;
  when?: (ctx: NavContext) => boolean;
}

export interface NavGroupDef {
  id: string;
  labelKey: TranslationKey;
  items: NavLinkDef[];
}

export type NavEntry = NavLinkDef | NavGroupDef;

export const isGroup = (entry: NavEntry): entry is NavGroupDef => "items" in entry;

export const MAIN_NAV: NavEntry[] = [
  {
    id: "research",
    labelKey: "nav.research",
    items: [
      { to: "/research", labelKey: "nav.researchAreas" },
      { to: "/projects", labelKey: "nav.projects" },
      { to: "/publications", labelKey: "nav.publications" },
      { to: "/news", labelKey: "nav.news" },
    ],
  },
  {
    id: "people",
    labelKey: "nav.people",
    items: [
      { to: "/team", labelKey: "nav.team" },
      { to: "/groups", labelKey: "nav.groups" },
    ],
  },
  {
    id: "community",
    labelKey: "nav.community",
    items: [
      { to: "/community/forum", labelKey: "nav.forum" },
      { to: "/events", labelKey: "nav.events" },
      { to: "/gallery", labelKey: "nav.gallery" },
    ],
  },
  { to: "/schedule", labelKey: "nav.schedule", when: (ctx) => ctx.signedIn },
  { to: "/contact", labelKey: "nav.contact" },
];

/** Signed-in only. "Log out" is an action, not a route, so Nav.tsx appends it to this group. */
export const ACCOUNT_NAV: NavGroupDef = {
  id: "account",
  labelKey: "nav.account",
  items: [
    { to: "/workspace", labelKey: "nav.workspace" },
    { to: "/profile", labelKey: "nav.myProfile" },
    { to: "/messages", labelKey: "nav.messages" },
    { to: "/notifications", labelKey: "nav.notifications" },
    { to: "/admin", labelKey: "nav.adminDashboard", when: (ctx) => ctx.canAccessAdmin },
  ],
};

export const LOGIN_LINK: NavLinkDef = { to: "/login", labelKey: "nav.login" };

const visible = (item: NavLinkDef, ctx: NavContext) => !item.when || item.when(ctx);

/** A group with only the links this visitor is shown, or null when none is left (never render an empty menu). */
export function resolveGroup(group: NavGroupDef, ctx: NavContext): NavGroupDef | null {
  const items = group.items.filter((item) => visible(item, ctx));
  return items.length ? { ...group, items } : null;
}

/** The entries this visitor is shown: filtered links, and groups left with at least one link. */
export function resolveNav(entries: NavEntry[], ctx: NavContext): NavEntry[] {
  const out: NavEntry[] = [];
  for (const entry of entries) {
    const resolved = isGroup(entry) ? resolveGroup(entry, ctx) : visible(entry, ctx) ? entry : null;
    if (resolved) out.push(resolved);
  }
  return out;
}

export function isLinkActive(link: NavLinkDef, pathname: string) {
  return !!matchPath({ path: link.to, end: !!link.end }, pathname);
}

/** The group holding the current page, so its trigger can look active while the menu is closed. */
export function groupContaining(entries: NavEntry[], pathname: string): string | null {
  for (const entry of entries) {
    if (isGroup(entry) && entry.items.some((item) => isLinkActive(item, pathname))) return entry.id;
  }
  return null;
}

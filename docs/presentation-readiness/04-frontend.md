# 04. Frontend deep dive

## Structure (VERIFIED)
- **Stack:** React 19, TypeScript, Vite, react-router-dom 6, plain CSS tokens (`apps/web/src/styles/tokens.css`, `base.css`, `components.css`, `pages.css`, `site.css`). No UI kit, no state library, no form library.
- **Entry:** `apps/web/src/main.tsx`; routes in `App.tsx` (about 44 page components in `pages/`, 85 files in `components/`). Large or rarely used pages are `React.lazy` chunks; a few are eager on purpose (`App.tsx` header comment). The production build produced 52 JavaScript chunks; the main chunk is about 432 KB raw and about 113 KB gzipped, plus a 333 KB chunk that holds the English and Japanese dictionaries (measured from `apps/web/dist/assets`, built during this audit session).
- **Providers:** `AuthContext` (current user from `GET /api/auth/me`), `LocaleContext` (language, `localStorage` key, sets `document.documentElement.lang`, `LocaleContext.tsx:39`).
- **Data fetching:** each page uses the small `useApiResource(path)` hook (`hooks/useApiResource.ts`): fetch on mount, `loading`, `error`, `status`, `reload`. Writes call `apiFetch` directly. There is no cache, no request de-duplication, no retry and no timeout (`lib/api.ts:27-39`): a hung request leaves the spinner until the browser gives up.
- **Forms:** controlled React inputs with local state and per-field error messages; the API's Zod messages are mapped to translated text by `i18n/errorMessages.ts`. Client-side checks are courtesy; the server revalidates everything with the same shared schemas.
- **Loading and error states:** shared `LoadingState`, `ErrorState` (with retry) and `EmptyState` components. `ProtectedRoute` shows a hard-coded English "Loading…" (`auth/ProtectedRoute.tsx:20`).

## Protected pages and role-dependent UI
- `ProtectedRoute` (`auth/ProtectedRoute.tsx:17-44`) sends a guest to `/login` (remembering the destination; the redirect target is checked by `isSafeRedirectPath`, `packages/shared/src/redirect.ts:10`) and sends a signed-in user who lacks the role to `/` **silently** (no "not allowed" message).
- Controls are shown with the same policy functions the API uses (`auth/usePolicy.ts`). This is cosmetic: every action is re-checked on the server (doc 06).
- **Admin dashboard** (`pages/admin/`): Overview, People & Accounts (admin only), Research content, Events, Community, Files & Gallery, Localization, Audit log, with a section menu in `AdminLayout.tsx`.

## Internationalisation
English and Japanese. The dictionary type forces both languages to have identical keys (`ja.ts` is typed `Record<keyof typeof en, string>`), and `unit-i18n` checks it (59 checks passed in this audit). Dates use `Intl` with a locale map (`lib/format.ts`). The language is stored in `localStorage` and defaults to English when nothing is stored (browser language is not detected, `LocaleContext.tsx`). User content can carry Japanese overrides (table `Translation`). Gaps are in doc 15.

## Responsive behavior
Plain CSS with 26 `@media` rules across five stylesheets and token-based fluid type (`clamp()`). A collapsible header menu appears on small screens ("Toggle menu"). Tested widths in this project's own browser scripts: 320, 375 and 1280 px. **Known issue:** two Help pages (`/docs/admin`, `/docs/maintenance`) scroll horizontally on a 375 px phone because of wide tables and code blocks (measured earlier in this engagement; pre-existing).
- Desktop: multi-column grids, header menus with dropdowns.
- Tablet: not separately tested in the repository (**UNKNOWN**); the CSS breakpoints should cover it.
- Mobile: single-column cards, hamburger menu, 44 px touch targets for research-link icons.

## Accessibility (summary; detail in doc 15)
Skip link, semantic landmarks, labels on inputs, visible focus ring, `aria-label` on icon links, decorative SVGs hidden, `prefers-reduced-motion` handling (3 rules). No automated axe scan; accessibility checks are bespoke Playwright scripts. The skip link text is English only (`App.tsx:111-112`).

## Limitations (honest list)
No client cache or offline mode; no request timeout; English-only skip link and loading text; silent redirect for forbidden pages; no dark theme; main bundle size is moderate but the dictionary chunk is large because both languages ship together; two Help pages overflow on phones; photo URLs that point to other sites would be blocked by the page's Content-Security-Policy (`img-src 'self' data:`, `index.html:30`; not browser-tested here).

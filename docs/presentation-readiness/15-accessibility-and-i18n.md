# 15. Accessibility and internationalisation

No automated accessibility scanner (axe or Lighthouse) is part of the repository; evidence comes from code review and the project's own Playwright scripts (`test:ui-a11y`, `test:alumni-ui`, `test:research-links-ui`). Anything about screen readers and real devices is **UNKNOWN** (not tested).

## Accessibility strengths (VERIFIED)
- Skip link to main content (`App.tsx:111`), landmark structure, `lang` attribute follows the chosen language (`LocaleContext.tsx:39`).
- Visible keyboard focus via one global `:focus-visible` rule (`styles/base.css:141`); keyboard tab-order and "covered element" checks in `test:ui-a11y`.
- Icon-only links carry `aria-label` and `title`; decorative SVGs are `aria-hidden` (research links).
- Touch targets at least 44 px for icon links (tested).
- Labels tied to inputs (`htmlFor`/`id`); error messages are linked (`aria` patterns in forms; spot-checked).
- `prefers-reduced-motion` handling (3 rules).
- Text wraps rather than overflows on long strings (tested for knowledge and resource pages).

## Weaknesses and gaps
- Skip link and the route "Loading…" text are English only (`App.tsx:111-112`, `ProtectedRoute.tsx:20`).
- Forbidden pages redirect silently to the home page.
- Brand logo colours (for example ResearchGate teal) are low contrast as colours; the control outline meets 3:1; logos are contrast-exempt.
- No dark theme; no high-contrast mode (`prefers-contrast` not handled).
- Two Help pages overflow horizontally on phones (wide tables and code).
- Colour-contrast of the whole palette was not audited with a tool (**Unknown**); tokens document intended contrast.
- No screen-reader testing; no automated WCAG scan; chart-like content: none.

## Mobile usability
Hamburger menu, single-column layouts, tested at 320, 375 px and 1280 px in the project's scripts. Tablet widths and real devices not tested.

## English and Japanese
- UI strings: typed dictionary with identical keys in both languages (compile-time and the `unit-i18n` test, 59 checks).
- User content: optional Japanese overrides per record (`Translation` table; managers edit in Admin, Localization). Records without an override show their original text.
- Server messages: API errors are English strings mapped to translated text in the client (`i18n/errorMessages.ts`); unmapped messages would remain English. Validation messages in forms are English (noted in earlier documentation).
- Language choice persists in `localStorage`; the default is English (browser language is not detected).
- Dates and months use `Intl` with the active locale (`lib/format.ts`). Times use the viewer's browser time zone.
- Guides: all six in-app guides exist in both languages; the Japanese text has not been reviewed by a native speaker.

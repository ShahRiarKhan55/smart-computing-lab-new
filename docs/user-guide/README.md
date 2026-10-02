# Smart Computing Lab — User Documentation

User-facing documentation for the actual, current Smart Computing Lab website — not an aspirational or generic description. Every instruction here reflects a route, permission or workflow that genuinely exists in the application (see each guide's source files for the exact routes it documents).

## Guides

| Guide | Audience | English | 日本語 |
|---|---|---|---|
| Quick Start | Anyone, new to the site | [`en/quick-start.md`](en/quick-start.md) | [`ja/quick-start.md`](ja/quick-start.md) |
| Public Visitor Guide | Visitors without an account | [`en/public-visitor-guide.md`](en/public-visitor-guide.md) | [`ja/public-visitor-guide.md`](ja/public-visitor-guide.md) |
| Researcher / Lab Member Guide | Signed-in lab members | [`en/researcher-guide.md`](en/researcher-guide.md) | [`ja/researcher-guide.md`](ja/researcher-guide.md) |
| Researcher Onboarding Guide | A researcher who just received an invitation | [`en/researcher-onboarding.md`](en/researcher-onboarding.md) | [`ja/researcher-onboarding.md`](ja/researcher-onboarding.md) |
| Administrator Guide | Lab administrators | [`en/admin-guide.md`](en/admin-guide.md) | [`ja/admin-guide.md`](ja/admin-guide.md) |
| Site Owner / Maintainer Guide | The technical maintainer | [`en/site-maintainer-guide.md`](en/site-maintainer-guide.md) | [`ja/site-maintainer-guide.md`](ja/site-maintainer-guide.md) |

## Also available

- **In the app**: `/docs` and its subpages render these same guides, with access control matching each guide's audience (public, signed-in, or admin-only — see `apps/web/src/pages/docs/`).
- **As PDF**: `npm run docs:pdf -w apps/server` generates one PDF per guide, per language, into `apps/server/dist-docs/pdf/` (gitignored build output, not committed — see that script's header for exact paths).

## Maintaining these guides

This is the single source of truth for both the web `/docs` pages and the generated PDFs — both are produced *from* these Markdown files (`apps/server/scripts/docs-render.mjs`), never maintained as a separate copy. Edit the `.md` source here; the rendered HTML/PDF output regenerates from it.

Keep both languages in sync: every `en/*.md` file must have a matching `ja/*.md` file (see `scripts/docs-render.mjs`, which fails loudly if one side is missing a file the other has).

This directory is distinct from [`docs/architecture/`](../architecture/), which is the implementation history and design rationale for each development phase — not user-facing, and not rendered anywhere in the app.

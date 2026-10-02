import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useLocale } from "../../i18n/LocaleContext";
import { ErrorState } from "../../components/ErrorState";

// Eagerly imports every generated docs content module (apps/web/src/docs/content/<slug>.<locale>.ts,
// produced by apps/server/scripts/docs-render.mjs from docs/user-guide/*.md — see that directory's
// README) into one lookup table, keyed by its file path. Vite resolves `import.meta.glob` entirely
// at build time; this never fetches markdown or runs a parser in the browser.
const MODULES = import.meta.glob<{ title: string; html: string }>("../../docs/content/*.*.ts", { eager: true });

function lookup(slug: string, locale: string): { title: string; html: string } | null {
  const key = Object.keys(MODULES).find((k) => k.endsWith(`/${slug}.${locale}.ts`));
  return key ? MODULES[key] : null;
}

/**
 * Renders one generated guide. The HTML comes from this repo's own Markdown sources
 * (docs/user-guide/*.md), never from user input, so rendering it directly is safe — there is no
 * injection vector here, unlike a generic "render arbitrary HTML" component would have.
 */
export function DocPage({ slug }: { slug: string }) {
  const { locale } = useLocale();
  const doc = lookup(slug, locale) ?? lookup(slug, "en");

  useDocumentTitle(doc?.title ?? null);

  if (!doc) {
    return <ErrorState message="This guide is not available." />;
  }

  return (
    <div className="container container--narrow docs-page">
      {/* eslint-disable-next-line react/no-danger -- see module comment: trusted, build-time-only content */}
      <div className="docs-page__body" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </div>
  );
}

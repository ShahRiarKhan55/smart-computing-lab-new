import { useEffect } from "react";
import { truncateForMeta } from "@scl/shared";

const SITE = "Smart Computing Lab";

export type JsonLd = Record<string, unknown>;

export interface SeoOptions {
  /** Plain page title, WITHOUT the " · Smart Computing Lab" suffix (added here, same convention
   * as the old useDocumentTitle). `null` leaves document.title untouched — for Home, whose static
   * index.html title ("Smart Computing Lab") is already correct and shouldn't be doubled. */
  title: string | null;
  /** Plain-text description; a page with none gets no <meta name="description"> at all. */
  description?: string | null;
  /** Path (e.g. "/team/abc") for the canonical link / og:url. Defaults to the current location. */
  canonicalPath?: string;
  /** One or more JSON-LD objects to publish as inert <script type="application/ld+json"> tags. */
  jsonLd?: JsonLd | JsonLd[];
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!content) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  // setAttribute never parses its value as markup, so hostile content in a title/bio/description
  // renders as inert attribute text — it cannot inject an element or run script.
  el.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Sets the document title (Home aside) plus, for a public page, a meta description, canonical
 * link, Open Graph tags and optional JSON-LD — all derived only from data already visible to this
 * viewer (never an id/email/internal field; callers only ever pass already-public record fields).
 *
 * Every write goes through setAttribute or a script element's `.text` — never innerHTML or
 * dangerouslySetInnerHTML — so hostile content (e.g. a title containing `</script><script>`)
 * renders as inert text/JSON and can never inject markup or execute.
 *
 * This is a client-rendered SPA: these tags exist only after this component mounts and React
 * runs. A crawler or link-unfurler that does not execute JavaScript (most social-preview bots,
 * e.g. Slack/Twitter/Facebook) will not see them; a crawler that does (Googlebot) will. That
 * limitation is inherent to a CSR SPA without SSR/prerendering — see
 * docs/architecture/phase24-public-research-showcase.md.
 */
export function useSeo({ title, description, canonicalPath, jsonLd }: SeoOptions) {
  const jsonLdList = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]).map((o) => JSON.stringify(o)) : [];
  // A stable string key so the effect doesn't re-run (and churn the DOM) on every render just
  // because callers pass a fresh object literal; content equality is what actually matters here.
  const jsonLdDepKey = jsonLdList.join("\u0000");

  useEffect(() => {
    if (title) document.title = `${title} · ${SITE}`;

    const desc = description ? truncateForMeta(description) : "";
    const path = canonicalPath ?? `${window.location.pathname}${window.location.search}`;
    const url = `${window.location.origin}${path}`;

    upsertMeta("name", "description", desc);
    upsertMeta("property", "og:title", title ?? SITE);
    upsertMeta("property", "og:description", desc);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:url", url);
    upsertCanonical(url);

    const scripts = jsonLdList.map((json) => {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.text = json; // not innerHTML: cannot be parsed as markup, cannot execute
      document.head.appendChild(script);
      return script;
    });

    return () => {
      if (title) document.title = SITE;
      upsertMeta("name", "description", "");
      upsertMeta("property", "og:title", "");
      upsertMeta("property", "og:description", "");
      upsertMeta("property", "og:type", "");
      upsertMeta("property", "og:url", "");
      upsertCanonical("");
      scripts.forEach((s) => s.remove());
    };
    // jsonLdDepKey stands in for jsonLd/jsonLdList (see comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, canonicalPath, jsonLdDepKey]);
}

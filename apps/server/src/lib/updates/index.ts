import type { LabUpdate, Locale, UpdateSourceInfo, UpdateSourceKind, UpdatesResponse } from "@scl/shared";
import { prisma } from "../prisma.js";
import { visibleTo } from "../visibility.js";
import { toNewsItem } from "../serializers.js";
import { loadTranslations, localize } from "../translations.js";

type Viewer = Parameters<typeof toNewsItem>[1];

/**
 * A source of homepage updates. Adding a source = one object here; the route and the page do not change.
 * Providers must return ONLY items that are already fit to show the given viewer (visibility applied inside).
 */
export interface UpdateProvider {
  id: string;
  kind: UpdateSourceKind;
  /** false = the source is known but not connected (no credentials/URL): it contributes nothing and says so honestly. */
  isConfigured(): boolean;
  list(viewer: Viewer, locale: Locale, limit: number): Promise<LabUpdate[]>;
}

/** The lab's own news, posted by hand in this application. Always available. */
export const manualNewsProvider: UpdateProvider = {
  id: "manual",
  kind: "manual",
  isConfigured: () => true,
  async list(viewer, locale, limit) {
    const rows = await prisma.newsItem.findMany({ where: visibleTo(viewer), orderBy: { sortDate: "desc" }, take: limit });
    const translations = await loadTranslations(prisma, "NEWS_ITEM", rows.map((r) => r.id), locale);
    return rows.map((r) => ({ ...toNewsItem(localize(r, "NEWS_ITEM", translations), viewer), source: { id: "manual", kind: "manual" as const } }));
  },
};

/**
 * Placeholder for a social-media feed. It is deliberately NEVER configured: no official Page URL or API
 * credential exists, and nothing may be scraped or invented. It exists so the model, the status report and the docs
 * show where such a source would plug in. See docs/architecture/phase27-lab-website-integrations.md
 * ("Facebook") for what an official integration would require.
 */
export const facebookProvider: UpdateProvider = {
  id: "facebook",
  kind: "external",
  isConfigured: () => false,
  list: async () => [],
};

export const UPDATE_PROVIDERS: UpdateProvider[] = [manualNewsProvider, facebookProvider];

/** Merges every configured provider's items, newest first. One failing provider never hides the others. */
export async function listUpdates(viewer: Viewer, locale: Locale, limit: number, providers: UpdateProvider[] = UPDATE_PROVIDERS): Promise<UpdatesResponse> {
  const sources: UpdateSourceInfo[] = [];
  const items: LabUpdate[] = [];
  for (const p of providers) {
    if (!p.isConfigured()) {
      sources.push({ id: p.id, kind: p.kind, status: "not_configured" });
      continue;
    }
    try {
      items.push(...(await p.list(viewer, locale, limit)));
      sources.push({ id: p.id, kind: p.kind, status: "active" });
    } catch (err) {
      console.error(`[updates] provider ${p.id} failed:`, (err as Error)?.name ?? "error");
      sources.push({ id: p.id, kind: p.kind, status: "error" });
    }
  }
  items.sort((a, b) => (a.sortDate < b.sortDate ? 1 : a.sortDate > b.sortDate ? -1 : a.id < b.id ? -1 : 1));
  return { items: items.slice(0, limit), sources };
}

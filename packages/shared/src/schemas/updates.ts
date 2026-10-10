import type { NewsItem } from "./news.js";

/**
 * Homepage "updates" (Phase 27 / P27.2). Provider-neutral on purpose: today the only active source is
 * the lab's own manually posted news; an external source (e.g. an official social-media Page) can be added as
 * another provider later without changing this shape. Each item says where it came from, so a visitor can
 * always tell lab-posted news from anything pulled in from elsewhere.
 */
export type UpdateSourceKind = "manual" | "external";
export type UpdateSourceStatus = "active" | "not_configured" | "error";

export interface UpdateSourceRef {
  id: string;
  kind: UpdateSourceKind;
}

export type LabUpdate = NewsItem & { source: UpdateSourceRef };

export interface UpdateSourceInfo extends UpdateSourceRef {
  status: UpdateSourceStatus;
}

export interface UpdatesResponse {
  items: LabUpdate[];
  sources: UpdateSourceInfo[];
}

/** Public, non-secret deployment settings the web app needs. */
export interface SiteConfig {
  /** The lab's public Google Sites portal, or null when none is configured. Never invented. */
  portalUrl: string | null;
  /** The lab's official Facebook Page (a link only), or null when none is configured or the value is not an acceptable Page URL. */
  facebookPageUrl: string | null;
}

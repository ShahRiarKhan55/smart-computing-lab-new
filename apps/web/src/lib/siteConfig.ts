import { useEffect, useState } from "react";
import type { SiteConfig } from "@scl/shared";
import { apiFetch } from "./api";

const NOTHING_CONFIGURED: SiteConfig = { portalUrl: null, facebookPageUrl: null };
let cached: Promise<SiteConfig> | null = null;

/**
 * Public deployment settings (the Google Sites portal link, the official Facebook Page link), fetched once per page load.
 * `ready` is false until the first answer (or failure) arrives, so a section can avoid flashing a "not configured" state
 * for a setting that is merely still loading. A failed fetch = "nothing configured".
 */
export function useSiteConfigState(): { config: SiteConfig; ready: boolean } {
  const [state, setState] = useState<{ config: SiteConfig; ready: boolean }>({ config: NOTHING_CONFIGURED, ready: false });
  useEffect(() => {
    let cancelled = false;
    cached ??= apiFetch<SiteConfig>("/site-config").catch(() => {
      cached = null; // try again on the next mount
      return NOTHING_CONFIGURED;
    });
    cached.then((c) => {
      if (!cancelled) setState({ config: { ...NOTHING_CONFIGURED, ...c }, ready: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function useSiteConfig(): SiteConfig {
  return useSiteConfigState().config;
}

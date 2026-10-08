import { useEffect, useState } from "react";
import type { SiteConfig } from "@scl/shared";
import { apiFetch } from "./api";

let cached: Promise<SiteConfig> | null = null;

/** Public deployment settings (e.g. the Google Sites portal link), fetched once per page load. Failure = "nothing configured". */
export function useSiteConfig(): SiteConfig {
  const [config, setConfig] = useState<SiteConfig>({ portalUrl: null });
  useEffect(() => {
    let cancelled = false;
    cached ??= apiFetch<SiteConfig>("/site-config").catch(() => {
      cached = null; // try again on the next mount
      return { portalUrl: null };
    });
    cached.then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}

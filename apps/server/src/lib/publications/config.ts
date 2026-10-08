import { DEFAULT_PROVIDER_HTTP, type ProviderHttpConfig } from "./http.js";

/**
 * Publication-importer configuration, read from the environment at call time.
 *
 * - `PUBLICATION_SYNC_CONTACT_EMAIL` — identifies this lab to ORCID/Crossref (their etiquette asks for a
 *   contact address; Crossref's "polite" pool is joined with a `mailto`). Defaults to the lab's public address.
 * - `ORCID_CLIENT_ID` / `ORCID_CLIENT_SECRET` — OPTIONAL ORCID Public API credentials. When both are set the
 *   importer obtains a `/read-public` token and sends it; otherwise it makes the unauthenticated public read
 *   that currently works. ORCID's documentation states a token is required, so configuring these is recommended.
 * - `PUBLICATION_SYNC_DELAY_MS` — pause between researchers (default 1000) so a sync stays a trickle.
 * - Outside production only (tests): `PUBLICATION_ORCID_BASE_URL`, `PUBLICATION_ORCID_TOKEN_URL`,
 *   `PUBLICATION_CROSSREF_BASE_URL`, `PUBLICATION_HTTP_RETRY_DELAY_MS` point the importer at a local mock.
 */
export interface PublicationSyncConfig {
  http: ProviderHttpConfig;
  orcidBaseUrl: string;
  orcidTokenUrl: string;
  crossrefBaseUrl: string;
  contactEmail: string;
  orcidClient: { id: string; secret: string } | null;
  delayBetweenResearchersMs: number;
}

export const DEFAULT_CONTACT_EMAIL = "susmartcomputinglab@gmail.com";

export function getPublicationSyncConfig(env: NodeJS.ProcessEnv = process.env): PublicationSyncConfig {
  const isProd = env.NODE_ENV === "production";
  const override = (name: string, fallback: string): string => (!isProd && env[name]?.trim() ? env[name]!.trim().replace(/\/+$/, "") : fallback);

  const orcidBaseUrl = override("PUBLICATION_ORCID_BASE_URL", "https://pub.orcid.org/v3.0");
  const orcidTokenUrl = override("PUBLICATION_ORCID_TOKEN_URL", "https://orcid.org/oauth/token");
  const crossrefBaseUrl = override("PUBLICATION_CROSSREF_BASE_URL", "https://api.crossref.org");

  const allowedHosts = new Set(DEFAULT_PROVIDER_HTTP.allowedHosts);
  let allowInsecure = false;
  if (!isProd) {
    for (const u of [orcidBaseUrl, orcidTokenUrl, crossrefBaseUrl]) {
      try {
        const parsed = new URL(u);
        if (parsed.protocol === "http:") allowInsecure = true;
        allowedHosts.add(parsed.host.toLowerCase());
      } catch {
        /* an unparsable override simply fails closed at request time */
      }
    }
  }

  const retryDelay = Number(env.PUBLICATION_HTTP_RETRY_DELAY_MS);
  const delay = Number(env.PUBLICATION_SYNC_DELAY_MS);
  const id = env.ORCID_CLIENT_ID?.trim();
  const secret = env.ORCID_CLIENT_SECRET?.trim();
  return {
    http: {
      ...DEFAULT_PROVIDER_HTTP,
      allowedHosts: [...allowedHosts],
      allowInsecure,
      ...(!isProd && Number.isFinite(retryDelay) && retryDelay >= 0 && env.PUBLICATION_HTTP_RETRY_DELAY_MS ? { retryDelayMs: retryDelay } : {}),
      ...(!isProd && env.PUBLICATION_HTTP_TIMEOUT_MS && Number(env.PUBLICATION_HTTP_TIMEOUT_MS) > 0 ? { timeoutMs: Number(env.PUBLICATION_HTTP_TIMEOUT_MS) } : {}),
    },
    orcidBaseUrl,
    orcidTokenUrl,
    crossrefBaseUrl,
    contactEmail: env.PUBLICATION_SYNC_CONTACT_EMAIL?.trim() || DEFAULT_CONTACT_EMAIL,
    orcidClient: id && secret ? { id, secret } : null,
    delayBetweenResearchersMs: Number.isFinite(delay) && delay >= 0 && env.PUBLICATION_SYNC_DELAY_MS ? delay : 1000,
  };
}

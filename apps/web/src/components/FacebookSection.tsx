import { parseFacebookPageUrl } from "@scl/shared";
import { useT } from "../i18n/LocaleContext";
import { useSiteConfigState } from "../lib/siteConfig";
import { Icon } from "./Icon";

/**
 * Homepage "Follow us on Facebook" section (Phase 27 completion, item A).
 *
 * A LINK to the lab's official Page when one is configured, and an honest "not connected yet" notice when it is not. It
 * retrieves and shows NO posts, Page details or statistics (nothing here can be fabricated): recent updates would need an
 * official Page plus an authorized Meta integration, which does not exist yet. When that is added, the post list belongs
 * inside this same section, below the heading, in place of (or beside) the link.
 *
 * The URL is re-validated here with the shared parser even though the server already did, so a link is never rendered from an
 * unchecked string. Nothing renders until the site configuration has answered, so a configured Page never flashes "not connected".
 */
export function FacebookSectionView({ pageUrl, ready }: { pageUrl: string | null; ready: boolean }) {
  const t = useT();
  if (!ready) return null;
  const href = parseFacebookPageUrl(pageUrl);
  return (
    <section className="section section--tight" aria-labelledby="home-facebook">
      {href ? (
        <div className="cta-band">
          <div>
            <p className="eyebrow">{t("home.fbEyebrow")}</p>
            <h2 id="home-facebook">{t("home.fbTitle")}</h2>
            <p className="text-muted">{t("home.fbDescription")}</p>
          </div>
          <a href={href} className="btn btn--secondary btn--lg" target="_blank" rel="noopener noreferrer">
            {t("home.fbAction")}
            <span className="sr-only">{t("publications.opensInNewTab")}</span> <Icon name="external" size={16} />
          </a>
        </div>
      ) : (
        <div>
          <p className="eyebrow">{t("home.fbEyebrow")}</p>
          <h2 id="home-facebook">{t("home.fbUnavailableTitle")}</h2>
          <p className="text-muted">{t("home.fbUnavailableText")}</p>
        </div>
      )}
    </section>
  );
}

export function FacebookSection() {
  const { config, ready } = useSiteConfigState();
  return <FacebookSectionView pageUrl={config.facebookPageUrl} ready={ready} />;
}

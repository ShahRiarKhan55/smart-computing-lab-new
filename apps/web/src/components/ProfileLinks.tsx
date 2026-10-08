import { profileLinksOf, type ProfileLink, type TeamMember } from "@scl/shared";
import { useT } from "../i18n/LocaleContext";

const LABEL_KEY = {
  scholar: "profileLinks.scholar",
  researchgate: "profileLinks.researchgate",
  orcid: "profileLinks.orcid",
} as const;
const ARIA_KEY = {
  scholar: "profileLinks.scholarAria",
  researchgate: "profileLinks.researchgateAria",
  orcid: "profileLinks.orcidAria",
} as const;

/** A small, restrained mark per service (text-based on purpose: no third-party brand artwork is bundled). */
const MARK: Record<ProfileLink["kind"], string> = { scholar: "GS", researchgate: "RG", orcid: "iD" };

/**
 * A person's optional Google Scholar / ResearchGate / ORCID links as compact chips. Renders NOTHING
 * when the person has none (no dead icons, no empty list). Every link has an accessible name that
 * includes the person's name and says it opens a new tab, uses a real <a> (keyboard focusable, with
 * the site's focus ring), and opens with rel="noopener noreferrer".
 */
export function ProfileLinks({ member, className = "" }: { member: Pick<TeamMember, "name" | "scholarUrl" | "researchGateUrl" | "orcid">; className?: string }) {
  const t = useT();
  const links = profileLinksOf(member);
  if (links.length === 0) return null;
  return (
    <ul className={`profile-links${className ? ` ${className}` : ""}`} aria-label={t("profileLinks.heading")}>
      {links.map((link) => (
        <li key={link.kind}>
          <a
            className={`profile-link profile-link--${link.kind}`}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t(ARIA_KEY[link.kind], { name: member.name })}
            title={t(LABEL_KEY[link.kind])}
          >
            <span className="profile-link__mark" aria-hidden="true">
              {MARK[link.kind]}
            </span>
            <span className="profile-link__text">{t(LABEL_KEY[link.kind])}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

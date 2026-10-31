import { isGoogleScholarUrl, isOrcidUrl, isResearchGateUrl, type TranslationKey } from "@scl/shared";
import { useT } from "../i18n/LocaleContext";
import { GoogleScholarIcon, OrcidIcon, ResearchGateIcon } from "./BrandIcons";

interface ResearchLinksProps {
  /** Only the fields below are read, so a TeamMember or a MemberProfile can be passed as is. */
  member: { name: string; googleScholarUrl: string; researchGateUrl: string; orcidUrl: string };
  className?: string;
}

interface LinkSpec {
  key: "googleScholar" | "researchGate" | "orcid";
  /** The service's own mark (components/BrandIcons.tsx), decorative: the link's aria-label is its name. */
  Icon: typeof GoogleScholarIcon;
  url: string;
  nameKey: TranslationKey;
  openKey: TranslationKey;
}

/**
 * Circular logo links to a person's Google Scholar, ResearchGate and ORCID profiles; renders nothing when none is set.
 * A stored value is shown only if it is exactly the canonical URL the server writes for that service (the server re-checks on
 * read as well), so a malformed value can never become a link. Links open in a new tab without referrer or opener access.
 */
export function ResearchLinks({ member, className = "" }: ResearchLinksProps) {
  const t = useT();
  const specs: LinkSpec[] = [
    { key: "googleScholar", Icon: GoogleScholarIcon, url: member.googleScholarUrl, nameKey: "research.googleScholar", openKey: "research.openGoogleScholar" },
    { key: "researchGate", Icon: ResearchGateIcon, url: member.researchGateUrl, nameKey: "research.researchGate", openKey: "research.openResearchGate" },
    { key: "orcid", Icon: OrcidIcon, url: member.orcidUrl, nameKey: "research.orcid", openKey: "research.openOrcid" },
  ];
  const valid = { googleScholar: isGoogleScholarUrl, researchGate: isResearchGateUrl, orcid: isOrcidUrl };
  const shown = specs.filter((s) => s.url && valid[s.key](s.url));
  if (shown.length === 0) return null;
  return (
    <ul className={`research-links${className ? ` ${className}` : ""}`} aria-label={t("research.linksLegend")}>
      {shown.map((s) => (
        <li key={s.key}>
          <a
            className={`research-link research-link--${s.key}`}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t(s.openKey, { name: member.name })}
            title={t(s.nameKey)}
          >
            <s.Icon />
          </a>
        </li>
      ))}
    </ul>
  );
}

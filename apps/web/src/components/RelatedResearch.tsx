import { Link } from "react-router-dom";
import { Icon } from "./Icon";
import { useT } from "../i18n/LocaleContext";

export interface ExploreLink {
  /** An app route whose query parameters the target page really reads (e.g. /publications?area=<id>). */
  to: string;
  label: string;
}

interface RelatedResearchProps {
  /** Unique heading id per page ("area" -> "area-explore"). */
  idPrefix: string;
  links: ExploreLink[];
}

/**
 * "Explore this research": a compact list of jumps from one record to a FILTERED list of its
 * neighbours (publications of this area, projects of this group, ...). It renders no data of its
 * own and makes no request: the records themselves are already listed on the page, and the filtered
 * list re-applies the viewer's visibility on its own page, so this cannot reveal anything hidden.
 * Duplicate targets are dropped; an empty list renders nothing.
 */
export function RelatedResearch({ idPrefix, links }: RelatedResearchProps) {
  const t = useT();
  const seen = new Set<string>();
  const unique = links.filter((l) => (seen.has(l.to) ? false : (seen.add(l.to), true)));
  if (unique.length === 0) return null;
  const id = `${idPrefix}-explore`;
  return (
    <section className="panel explore" aria-labelledby={id}>
      <h2 className="panel__title" id={id}>
        {t("explore.title")}
      </h2>
      <ul className="explore__list">
        {unique.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="explore__link">
              <span>{l.label}</span>
              <Icon name="arrow-right" size={14} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

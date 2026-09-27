import { Link } from "react-router-dom";
import { RESOURCE_FAMILIES, RESOURCE_PANEL_LIMIT, RESOURCE_TYPE_FAMILY, type ResourceListResponse, type ResourceSummary } from "@scl/shared";
import { useApiResource } from "../hooks/useApiResource";
import { useLocale } from "../i18n/LocaleContext";
import { RESOURCE_FAMILY_LABEL_KEY } from "../i18n/labels";
import { formatNumber } from "../lib/format";
import { Icon } from "./Icon";
import { ResourceTypeBadge } from "./ResourceTypeBadge";
import { SectionHeader } from "./SectionHeader";

/**
 * "What does it take to reproduce this project?" — the project's linked resources, grouped by kind
 * (hardware, software & models, data, environment), each with its type, version and vendor and a link to
 * the full record. Bounded: the newest RESOURCE_PANEL_LIMIT resources (`GET /api/resources?project=<id>`),
 * then a "View all" link. Omitted while loading, on error and when the viewer may see none, so a project
 * without resources is unchanged. Visibility is entirely the API's: a hidden resource is never listed or counted.
 */
export function ReproducibilityPanel({ projectId }: { projectId: string }) {
  const { locale, t } = useLocale();
  const { data } = useApiResource<ResourceListResponse>(`/resources?project=${encodeURIComponent(projectId)}&limit=${RESOURCE_PANEL_LIMIT}`);
  if (!data || data.items.length === 0) return null;
  const total = data.pagination.total;
  const groups = RESOURCE_FAMILIES.map((family) => ({
    family,
    items: data.items.filter((r) => RESOURCE_TYPE_FAMILY[r.resourceType] === family).sort(byName),
  })).filter((g) => g.items.length > 0);

  return (
    <section className="detail-section repro-panel" aria-labelledby="project-repro">
      <SectionHeader
        compact
        id="project-repro"
        title={t("resource.repro.heading")}
        description={t("resource.repro.description")}
        action={
          <Link className="link section-header__link" to={`/resources?project=${encodeURIComponent(projectId)}`}>
            {t("resource.repro.viewAll", { count: formatNumber(total, locale) })} <Icon name="arrow-right" size={14} />
          </Link>
        }
      />
      <div className="repro-panel__groups" role="list" aria-label={t("resource.repro.aria")}>
        {groups.map((g) => (
          <div role="listitem" key={g.family} className="repro-group">
            <h3 className="repro-group__title">{t(RESOURCE_FAMILY_LABEL_KEY[g.family])}</h3>
            <ul className="repro-group__list">
              {g.items.map((r) => (
                <li key={r.id} className="repro-item">
                  <ResourceTypeBadge type={r.resourceType} />
                  <Link className="link repro-item__name" to={`/resources/${r.id}`}>
                    {r.name}
                  </Link>
                  {[r.version, r.vendor].filter(Boolean).length > 0 && <span className="text-muted repro-item__meta">{[r.version, r.vendor].filter(Boolean).join(" · ")}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Name A-Z with a code-unit tiebreak, so the panel's order does not depend on the browser's locale. */
const byName = (a: ResourceSummary, b: ResourceSummary) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1);

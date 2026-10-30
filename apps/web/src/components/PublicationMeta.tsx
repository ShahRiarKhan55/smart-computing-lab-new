import type { Publication, TranslationKey } from "@scl/shared";
import { useLocale } from "../i18n/LocaleContext";
import { formatCalendarDate, formatYearMonth } from "../lib/format";
import { metaEntries, type MetaEntry } from "../lib/publicationMeta";

/** The stated value of one metadata entry, formatted for the viewer's language (never an empty label: only stated entries exist). */
function useMetaText(p: Publication) {
  const { t, locale } = useLocale();
  const label = (e: MetaEntry) => t(`publications.meta.${e.key}` as TranslationKey);
  const value = (e: MetaEntry) => {
    if (e.key === "status") return t(`publications.meta.status.${e.value}` as TranslationKey);
    if (e.key === "month") return formatYearMonth(p.year, Number(e.value), locale);
    if (e.key === "acceptedDate") return formatCalendarDate(e.value, locale);
    return e.value;
  };
  return { label, value };
}

/** One compact line for the publication list: "Label: value · Label: value". Renders nothing when no metadata is stated. */
export function PublicationMetaLine({ publication: p }: { publication: Publication }) {
  const entries = metaEntries(p);
  const { label, value } = useMetaText(p);
  if (entries.length === 0) return null;
  return <p className="pub-item__meta">{entries.map((e) => `${label(e)}: ${value(e)}`).join(" · ")}</p>;
}

/** The labelled list for the publication's own page. Renders nothing when no metadata is stated. */
export function PublicationMetaList({ publication: p }: { publication: Publication }) {
  const { t } = useLocale();
  const entries = metaEntries(p);
  const { label, value } = useMetaText(p);
  if (entries.length === 0) return null;
  return (
    <section className="pub-meta" aria-label={t("publications.meta.heading")}>
      <h2 className="pub-meta__title">{t("publications.meta.heading")}</h2>
      <dl className="pub-meta__list">
        {entries.map((e) => (
          <div key={e.key} className="pub-meta__row">
            <dt>{label(e)}</dt>
            <dd>{value(e)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

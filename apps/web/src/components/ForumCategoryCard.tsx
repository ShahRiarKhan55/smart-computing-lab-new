import { Link } from "react-router-dom";
import type { ForumCategory } from "@scl/shared";
import { Icon } from "./Icon";
import { VisibilityBadge } from "./VisibilityField";
import { formatDateTime } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

/** Reuses the site's ordinary .card shape (see ProjectCard/GroupCard) — a category is content like any other. */
export function ForumCategoryCard({ category }: { category: ForumCategory }) {
  const { locale, t } = useLocale();
  return (
    <div className="card card--interactive">
      <div className="card__top">
        <h3 className="card__title">
          <Link to={`/community/forum/category/${category.slug}`}>{category.name}</Link>
        </h3>
        <VisibilityBadge visibility={category.visibility} />
        {category.isLocked && (
          <span className="badge badge--warn badge--upper">
            <Icon name="lock" size={11} /> {t("forum.locked")}
          </span>
        )}
      </div>
      {category.description && <p className="card__text">{category.description}</p>}
      <div className="card__foot card__meta">
        {t(category.topicCount === 1 ? "forum.topicCountOne" : "forum.topicCountOther", { count: category.topicCount })}
        {category.lastActivityAt && <> · {t("forum.lastActivityAt", { date: formatDateTime(category.lastActivityAt, locale) })}</>}
      </div>
    </div>
  );
}

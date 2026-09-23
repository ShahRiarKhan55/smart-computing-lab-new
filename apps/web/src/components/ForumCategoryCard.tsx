import { Link } from "react-router-dom";
import type { ForumCategory } from "@scl/shared";
import { Icon } from "./Icon";
import { VisibilityBadge } from "./VisibilityField";
import { formatDateTime } from "../lib/format";

/** Reuses the site's ordinary .card shape (see ProjectCard/GroupCard) — a category is content like any other. */
export function ForumCategoryCard({ category }: { category: ForumCategory }) {
  return (
    <div className="card card--interactive">
      <div className="card__top">
        <h3 className="card__title">
          <Link to={`/community/forum/category/${category.slug}`}>{category.name}</Link>
        </h3>
        <VisibilityBadge visibility={category.visibility} />
        {category.isLocked && (
          <span className="badge badge--warn badge--upper">
            <Icon name="lock" size={11} /> Locked
          </span>
        )}
      </div>
      {category.description && <p className="card__text">{category.description}</p>}
      <div className="card__foot card__meta">
        {category.topicCount} {category.topicCount === 1 ? "topic" : "topics"}
        {category.lastActivityAt && <> · Last activity {formatDateTime(category.lastActivityAt)}</>}
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import type { ForumTopicSummary } from "@scl/shared";
import { Icon } from "./Icon";
import { ForumContextBadge } from "./ForumContextBadge";
import { formatDateTime } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

interface ForumTopicCardProps {
  topic: ForumTopicSummary;
  /** Hide the category link on a page that is already scoped to one category. */
  showCategory?: boolean;
}

const totalReactions = (t: ForumTopicSummary) => Object.values(t.reactions.counts).reduce((a, b) => a + b, 0);

/** One row in a topic list: title, author/category/project/date, a short excerpt, comment/reaction counts. */
export function ForumTopicCard({ topic, showCategory = true }: ForumTopicCardProps) {
  const { locale, t } = useLocale();
  const reactions = totalReactions(topic);
  return (
    <li>
      <article className={`topic-row${topic.pinned ? " topic-row--pinned" : ""}`}>
        <div className="topic-row__top">
          <h3 className="topic-row__title">
            <Link to={`/community/forum/topic/${topic.id}`}>{topic.title}</Link>
          </h3>
          <ForumContextBadge pinned={topic.pinned} locked={topic.locked} status={topic.status} />
        </div>
        <p className="topic-row__meta">
          {topic.author.teamMemberId ? (
            <Link to={`/team/${topic.author.teamMemberId}`} className="link-inline">
              {topic.author.name}
            </Link>
          ) : (
            topic.author.name
          )}
          {showCategory && (
            <>
              {" · "}
              <Link to={`/community/forum/category/${topic.category.slug}`} className="link-inline">
                {topic.category.name}
              </Link>
            </>
          )}
          {topic.project && (
            <>
              {" · "}
              <Link to={`/projects/${topic.project.id}`} className="link-inline">
                {topic.project.title}
              </Link>
            </>
          )}
          {" · "}
          {formatDateTime(topic.lastActivityAt, locale)}
        </p>
        {topic.excerpt && <p className="topic-row__excerpt">{topic.excerpt}</p>}
        <div className="topic-row__stats">
          <span>
            <Icon name="file" size={14} /> {t(topic.commentCount === 1 ? "forum.commentCountOne" : "forum.commentCountOther", { count: topic.commentCount })}
          </span>
          <span>
            <Icon name="check" size={14} /> {t(reactions === 1 ? "forum.reactionCountOne" : "forum.reactionCountOther", { count: reactions })}
          </span>
        </div>
      </article>
    </li>
  );
}

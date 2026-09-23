import type { ForumTopicSummary } from "@scl/shared";
import { ForumTopicCard } from "./ForumTopicCard";
import { EmptyState } from "./EmptyState";
import { useT } from "../i18n/LocaleContext";

interface ForumTopicListProps {
  topics: ForumTopicSummary[];
  showCategory?: boolean;
  emptyTitle?: string;
}

export function ForumTopicList({ topics, showCategory = true, emptyTitle }: ForumTopicListProps) {
  const t = useT();
  if (topics.length === 0) return <EmptyState title={emptyTitle ?? t("forum.emptyTopics")} compact />;
  return (
    <ol className="forum-topic-list">
      {topics.map((topic) => (
        <ForumTopicCard key={topic.id} topic={topic} showCategory={showCategory} />
      ))}
    </ol>
  );
}

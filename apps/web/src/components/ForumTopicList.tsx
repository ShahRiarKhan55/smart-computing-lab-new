import type { ForumTopicSummary } from "@scl/shared";
import { ForumTopicCard } from "./ForumTopicCard";
import { EmptyState } from "./EmptyState";

interface ForumTopicListProps {
  topics: ForumTopicSummary[];
  showCategory?: boolean;
  emptyTitle?: string;
}

export function ForumTopicList({ topics, showCategory = true, emptyTitle = "No topics yet." }: ForumTopicListProps) {
  if (topics.length === 0) return <EmptyState title={emptyTitle} compact />;
  return (
    <ol className="forum-topic-list">
      {topics.map((t) => (
        <ForumTopicCard key={t.id} topic={t} showCategory={showCategory} />
      ))}
    </ol>
  );
}

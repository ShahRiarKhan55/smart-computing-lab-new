import { en } from "@scl/shared";
import type { Category, EventKind, GalleryCategory, KnowledgeCategory, ProjectStatus, SearchFilter, SearchType, TranslationKey } from "@scl/shared";

/** Localized label for a team member's category — same `Record<value, TranslationKey>`
 * convention as `ROLE_LABEL_KEY` in `auth/usePolicy.ts`. The stored value is unchanged in every
 * locale; only the displayed label is translated. */
export const CATEGORY_LABEL_KEY: Record<Category, TranslationKey> = {
  FACULTY: "team.category.FACULTY",
  PHD: "team.category.PHD",
  MSC: "team.category.MSC",
  BSC: "team.category.BSC",
  RESEARCH: "team.category.RESEARCH",
};

/** Localized label for a gallery item's category. */
export const GALLERY_CATEGORY_LABEL_KEY: Record<GalleryCategory, TranslationKey> = {
  LAB_LIFE: "gallery.category.LAB_LIFE",
  EVENT: "gallery.category.EVENT",
  RESEARCH: "gallery.category.RESEARCH",
  OTHER: "gallery.category.OTHER",
};

/** Localized label for a project's status. */
export const PROJECT_STATUS_LABEL_KEY: Record<ProjectStatus, TranslationKey> = {
  PLANNED: "projects.status.PLANNED",
  ACTIVE: "projects.status.ACTIVE",
  COMPLETED: "projects.status.COMPLETED",
  ARCHIVED: "projects.status.ARCHIVED",
};

/** Localized label for a search result's entity type. */
export const SEARCH_TYPE_LABEL_KEY: Record<SearchType, TranslationKey> = {
  "research-area": "search.type.research-area",
  project: "search.type.project",
  group: "search.type.group",
  researcher: "search.type.researcher",
  publication: "search.type.publication",
  news: "search.type.news",
  "forum-topic": "search.type.forum-topic",
  event: "search.type.event",
  knowledge: "search.type.knowledge",
};

/** Localized label for a search type filter chip. */
export const SEARCH_FILTER_LABEL_KEY: Record<SearchFilter, TranslationKey> = {
  all: "search.filter.all",
  "research-area": "search.filter.research-area",
  project: "search.filter.project",
  group: "search.filter.group",
  researcher: "search.filter.researcher",
  publication: "search.filter.publication",
  news: "search.filter.news",
  "forum-topic": "search.filter.forum-topic",
  event: "search.filter.event",
  knowledge: "search.filter.knowledge",
};

/** Localized call-to-action text on a search result card. */
export const SEARCH_CTA_LABEL_KEY: Record<SearchType, TranslationKey> = {
  "research-area": "search.cta.research-area",
  project: "search.cta.project",
  group: "search.cta.group",
  researcher: "search.cta.researcher",
  publication: "search.cta.publication",
  news: "search.cta.news",
  "forum-topic": "search.cta.forum-topic",
  event: "search.cta.event",
  knowledge: "search.cta.knowledge",
};

/** Localized label for an event's type. The stored `kind` value is unchanged in every locale. */
export const EVENT_KIND_LABEL_KEY: Record<EventKind, TranslationKey> = {
  SEMINAR: "events.kind.SEMINAR",
  MEETING: "events.kind.MEETING",
  DEADLINE: "events.kind.DEADLINE",
  SOCIAL: "events.kind.SOCIAL",
  OTHER: "events.kind.OTHER",
};

/** Localized label for a knowledge document's category. The stored value is unchanged in every locale. */
export const KNOWLEDGE_CATEGORY_LABEL_KEY: Record<KnowledgeCategory, TranslationKey> = {
  PROJECT_DOCUMENTATION: "knowledge.category.PROJECT_DOCUMENTATION",
  RESEARCH_NOTE: "knowledge.category.RESEARCH_NOTE",
  METHODOLOGY: "knowledge.category.METHODOLOGY",
  EXPERIMENT: "knowledge.category.EXPERIMENT",
  HARDWARE: "knowledge.category.HARDWARE",
  SOFTWARE: "knowledge.category.SOFTWARE",
  DATASET: "knowledge.category.DATASET",
  REPRODUCIBILITY: "knowledge.category.REPRODUCIBILITY",
  LAB_PROCEDURE: "knowledge.category.LAB_PROCEDURE",
  RESOURCE: "knowledge.category.RESOURCE",
};

/**
 * Admin (Phase 17) labels whose VALUE set is open-ended on the server (audit actions and entity types
 * grow with every phase; relation and translation-field names are plain strings on the wire). Looks
 * `prefix + value` up in the dictionary and falls back to the raw value, so an action added later
 * without a label still renders as readable text instead of a missing-key string.
 */
export function dictLabel(t: (key: TranslationKey) => string, prefix: string, value: string): string {
  const key = `${prefix}${value}` as TranslationKey;
  return Object.prototype.hasOwnProperty.call(en, key) ? t(key) : value;
}

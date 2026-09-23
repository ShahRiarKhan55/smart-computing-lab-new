import type { Category, GalleryCategory, ProjectStatus, TranslationKey } from "@scl/shared";

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

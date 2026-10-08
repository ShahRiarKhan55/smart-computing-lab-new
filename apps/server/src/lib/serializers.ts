import { canEditOwnProfile, isManager } from "@scl/shared";
import type {
  AreaRef,
  NewsItem,
  Publication,
  ProjectMemberRole,
  ProjectStatus,
  GroupMemberRole,
  ResearchArea,
  TeamMember,
} from "@scl/shared";
import { visibilityField, type Viewer } from "./visibility.js";

/** Row -> API shape. `visibility` is included only for viewers who may change it. */

/**
 * Whether a profile belongs to the viewer's own account. Decided here, on the server, so the
 * account id (`TeamMember.userId`) never has to leave it. A guest, an unlinked profile and
 * every other member's profile are all `false`.
 */
export const isOwnProfile = (viewer: Viewer, profileUserId: string | null): boolean =>
  canEditOwnProfile(viewer, profileUserId);

/** A team profile as the public API shows it. Never includes `userId`. */
export function toTeamMember(
  row: {
    id: string;
    userId: string | null;
    name: string;
    initials: string;
    role: string;
    category: string;
    department: string;
    bio: string;
    photoUrl: string;
    scholarUrl: string;
    researchGateUrl: string;
    orcid: string;
    isPublished: boolean;
    sortOrder: number;
  },
  viewer: Viewer,
): TeamMember {
  return {
    id: row.id,
    isOwn: isOwnProfile(viewer, row.userId),
    name: row.name,
    initials: row.initials,
    role: row.role,
    category: row.category as TeamMember["category"],
    department: row.department,
    bio: row.bio,
    photoUrl: row.photoUrl,
    scholarUrl: row.scholarUrl,
    researchGateUrl: row.researchGateUrl,
    orcid: row.orcid,
    // Only people who can change it learn whether a profile is hidden (a public caller never sees an unpublished row at all).
    ...(isManager(viewer) ? { isPublished: row.isPublished } : {}),
    sortOrder: row.sortOrder,
  };
}

export function toPublication(
  row: {
    id: string;
    year: number;
    title: string;
    authors: string;
    venue: string;
    pdfUrl: string;
    doiUrl: string;
    extraUrl: string;
    extraLabel: string;
    visibility: string;
  },
  viewer: Viewer,
): Publication {
  return {
    id: row.id,
    year: row.year,
    title: row.title,
    authors: row.authors,
    venue: row.venue,
    pdfUrl: row.pdfUrl,
    doiUrl: row.doiUrl,
    extraUrl: row.extraUrl,
    extraLabel: row.extraLabel,
    ...visibilityField(viewer, row.visibility),
  };
}

export function toNewsItem(
  row: {
    id: string;
    dateLabel: string;
    sortDate: string;
    type: string;
    emoji: string;
    title: string;
    description: string;
    visibility: string;
  },
  viewer: Viewer,
): NewsItem {
  return {
    id: row.id,
    date: row.dateLabel,
    sortDate: row.sortDate,
    type: row.type,
    emoji: row.emoji,
    title: row.title,
    description: row.description,
    ...visibilityField(viewer, row.visibility),
  };
}

export function toResearchArea(
  row: { id: string; icon: string; title: string; description: string; tag: string; sortOrder: number; visibility: string },
  viewer: Viewer,
): ResearchArea {
  return {
    id: row.id,
    icon: row.icon,
    title: row.title,
    description: row.description,
    tag: row.tag,
    sortOrder: row.sortOrder,
    ...visibilityField(viewer, row.visibility),
  };
}

export const toAreaRef = (row: { id: string; icon: string; title: string; tag: string }): AreaRef => ({
  id: row.id,
  icon: row.icon,
  title: row.title,
  tag: row.tag,
});

/** LEAD first, then by name: the order used everywhere members are listed. */
export function sortMembersLeadFirst<T extends { role: string; name: string }>(members: T[]): T[] {
  return [...members].sort((a, b) => (a.role === "LEAD" ? 0 : 1) - (b.role === "LEAD" ? 0 : 1) || a.name.localeCompare(b.name));
}

export const asProjectStatus = (v: string) => v as ProjectStatus;
export const asProjectRole = (v: string) => v as ProjectMemberRole;
export const asGroupRole = (v: string) => v as GroupMemberRole;

/** DateTime column -> "YYYY-MM-DD" (or null). */
export const toIsoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
/** "YYYY-MM-DD" -> DateTime at UTC midnight (or null). */
export const fromIsoDate = (s: string | null): Date | null => (s ? new Date(`${s}T00:00:00.000Z`) : null);

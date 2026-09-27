import { z } from "zod";
import { idSchema } from "./common.js";
import { groupMemberRoleSchema, projectMemberRoleSchema, type AreaRef, type ProjectMemberRole, type ProjectStatus, type GroupMemberRole } from "./project.js";
import type { Visibility } from "./enums.js";
import type { Publication } from "./publication.js";
import type { NewsItem } from "./news.js";
import type { LabEvent } from "./event.js";
import type { KnowledgeSection } from "./knowledge.js";
import type { ResourceSection } from "./resource.js";

/** Phase 21: how many rows each workspace section carries. A section over its cap links to the full list page instead. */
export const WORKSPACE_LIMITS = { areas: 12, projects: 12, groups: 12, publications: 6, events: 6, news: 5, knowledge: 5, resources: 5, collaborators: 24 } as const;

/** A public team profile reference (never an account id or e-mail). */
export interface WorkspacePerson {
  id: string;
  name: string;
  initials: string;
}

export interface WorkspaceSection<T> {
  items: T[];
  /** Everything the viewer may see for this section (>= items.length); the cap only limits `items`. */
  total: number;
}

export interface WorkspaceArea extends AreaRef {
  /** Only for accounts that may change visibility. */
  visibility?: Visibility;
  projectCount: number;
  researcherCount: number;
  /** true: on the researcher's own profile; false: reached only through one of their projects. */
  linked: boolean;
}

export interface WorkspaceProject {
  id: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  visibility?: Visibility;
  group: { id: string; name: string } | null;
  areas: AreaRef[];
  leads: WorkspacePerson[];
  memberCount: number;
  publicationCount: number;
  upcomingEventCount: number;
  myRole: ProjectMemberRole;
  /** UX hint only; the API re-checks. */
  canManageMembers: boolean;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  visibility?: Visibility;
  leads: WorkspacePerson[];
  memberCount: number;
  projectCount: number;
  areaCount: number;
  myRole: GroupMemberRole;
  canManageMembers: boolean;
}

export interface WorkspaceCollaborator extends WorkspacePerson {
  /** The person's lab role text as shown on the public team page (e.g. "PhD Student"). */
  role: string;
  sharedProjects: number;
  sharedGroups: number;
  sharedAreas: number;
}

export interface WorkspaceResponse {
  /** null when the signed-in account has no linked team profile: every section is then empty. */
  profile: (WorkspacePerson & { role: string }) | null;
  areas: WorkspaceSection<WorkspaceArea>;
  projects: WorkspaceSection<WorkspaceProject>;
  groups: WorkspaceSection<WorkspaceGroup>;
  publications: WorkspaceSection<Publication>;
  events: WorkspaceSection<LabEvent>;
  news: WorkspaceSection<NewsItem>;
  /** Phase 22: documents the researcher wrote or that belong to their projects, groups and areas (same visibility as everywhere). */
  knowledge: KnowledgeSection;
  /** Phase 23: resources the researcher owns, is named on, or that are linked to their projects, groups and areas. */
  resources: ResourceSection;
  collaborators: WorkspaceSection<WorkspaceCollaborator>;
}

/** POST /projects/:id/members and /groups/:id/members: add ONE researcher. */
export const addProjectMemberSchema = z.object({ teamMemberId: idSchema, role: projectMemberRoleSchema.default("MEMBER") });
export const addGroupMemberSchema = z.object({ teamMemberId: idSchema, role: groupMemberRoleSchema.default("MEMBER") });
/** PUT /projects/:id/members/:teamMemberId and /groups/...: change ONE researcher's role (incl. lead). */
export const setProjectMemberRoleSchema = z.object({ role: projectMemberRoleSchema });
export const setGroupMemberRoleSchema = z.object({ role: groupMemberRoleSchema });

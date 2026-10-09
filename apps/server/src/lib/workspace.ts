import type { Prisma } from "@prisma/client";
import {
  WORKSPACE_LIMITS,
  canManageGroupMembers,
  canManageProjectMembers,
  type Locale,
  type WorkspaceArea,
  type WorkspaceCollaborator,
  type WorkspaceGroup,
  type WorkspacePerson,
  type WorkspaceProject,
  type WorkspaceResponse,
  type WorkspaceSection,
} from "@scl/shared";
import { prisma } from "./prisma.js";
import { canView, visibilityField, visibleTo, type Viewer } from "./visibility.js";
import { asGroupRole, asProjectRole, asProjectStatus, toAreaRef } from "./serializers.js";
import { linkedPersonVisible } from "./hiddenPeople.js";
import { eventInclude, eventOrderBy, eventScopeWhere, serializeEvents } from "./eventSerializers.js";
import { loadRefTranslations, localizedNews, localizedPublications, pick } from "./researchGraph.js";
import { loadTranslations, localize } from "./translations.js";
import { loadKnowledgeSection, researcherScope } from "./knowledge.js";
import { loadResourceSection, resourceScope } from "./resources.js";

/**
 * Phase 21: the research collaboration workspace is a READ model over relationships that already exist
 * (ProjectMember, GroupMember, ResearcherArea, PublicationAuthor, NewsAuthor, Project->Event/News). It
 * adds no table and no relationship of its own, and it decides nothing about visibility: every related
 * row is selected through the same `visibleTo(viewer)` fragment as every other read, IN the query, and
 * every count is a filtered relation count, so a hidden record can be neither listed nor counted.
 *
 * "The researcher" is the TeamMember linked to the session's account (`TeamMember.userId`). A manager or
 * admin gets THEIR OWN workspace by the same lookup; nothing here takes an id from the request, so it
 * cannot be pointed at someone else, and it never touches messages or notifications.
 *
 * Query budget: a fixed number of queries (about 14, +5 translation lookups for ja) whatever the data
 * size — every section is one bounded `take` plus one count, and related titles are localized in batches.
 */

const L = WORKSPACE_LIMITS;
/** Defensive scan bound for each collaborator source query (a lab has tens of people, not thousands). */
const COLLAB_SCAN = 2000;

const emptySection = <T>(): WorkspaceSection<T> => ({ items: [], total: 0 });

/** The workspace of a signed-in account without a linked team profile: nothing to show, nothing invented. */
export const emptyWorkspace = (): WorkspaceResponse => ({
  profile: null,
  areas: emptySection(),
  projects: emptySection(),
  groups: emptySection(),
  publications: emptySection(),
  events: emptySection(),
  news: emptySection(),
  knowledge: emptySection(),
  resources: emptySection(),
  collaborators: emptySection(),
});

/** Total order that does not depend on ICU/locale: code-unit comparison, then id. */
const byText = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export async function loadWorkspace(viewer: NonNullable<Viewer>, locale: Locale, now = new Date()): Promise<WorkspaceResponse> {
  const me = await prisma.teamMember.findUnique({ where: { userId: viewer.id }, select: { id: true, name: true, initials: true, role: true } });
  if (!me) return emptyWorkspace();

  const visible = visibleTo(viewer);
  const mine = { teamMemberId: me.id };

  // Projects that "count" for events and news: the researcher's own, those of their groups, and those in
  // their areas. All three are real rows, and the project itself must be visible to the viewer.
  const relatedProjects: Prisma.ResearchProjectWhereInput = {
    ...visible,
    OR: [
      { members: { some: mine } },
      { group: { ...visible, members: { some: mine } } },
      { areaLinks: { some: { researchArea: { ...visible, researcherLinks: { some: mine } } } } },
    ],
  };
  const myProjectsWhere: Prisma.ProjectMemberWhereInput = { ...mine, project: visible };
  const myGroupsWhere: Prisma.GroupMemberWhereInput = { ...mine, group: visible };
  const areasWhere: Prisma.ResearchAreaWhereInput = {
    ...visible,
    OR: [{ researcherLinks: { some: mine } }, { projectLinks: { some: { project: { ...visible, members: { some: mine } } } } }],
  };
  const pubsWhere: Prisma.PublicationWhereInput = { ...visible, authorLinks: { some: mine } };
  const eventsWhere: Prisma.EventWhereInput = { ...visible, ...eventScopeWhere("upcoming", now), project: relatedProjects };
  const newsWhere: Prisma.NewsItemWhereInput = { ...visible, OR: [{ project: relatedProjects }, { authorLinks: { some: mine } }] };

  const [
    projectRows, projectTotal,
    groupRows, groupTotal,
    areaRows, areaTotal,
    pubRows, pubTotal,
    eventRows, eventTotal,
    newsRows, newsTotal,
    projectCollab, groupCollab, areaCollab,
  ] = await Promise.all([
    prisma.projectMember.findMany({
      where: myProjectsWhere,
      orderBy: [{ project: { sortOrder: "asc" } }, { project: { title: "asc" } }, { projectId: "asc" }],
      take: L.projects,
      select: {
        role: true,
        project: {
          select: {
            id: true,
            title: true,
            summary: true,
            status: true,
            visibility: true,
            group: { select: { id: true, name: true, visibility: true } },
            areaLinks: {
              where: { researchArea: visible },
              select: { researchArea: { select: { id: true, icon: true, title: true, tag: true, sortOrder: true } } },
            },
            members: { where: { role: "LEAD", ...linkedPersonVisible(viewer) }, select: { teamMember: { select: { id: true, name: true, initials: true } } } },
            _count: {
              select: {
                members: { where: linkedPersonVisible(viewer) },
                publications: { where: { publication: visible } },
                events: { where: { ...visible, ...eventScopeWhere("upcoming", now) } },
              },
            },
          },
        },
      },
    }),
    prisma.projectMember.count({ where: myProjectsWhere }),

    prisma.groupMember.findMany({
      where: myGroupsWhere,
      orderBy: [{ group: { sortOrder: "asc" } }, { group: { name: "asc" } }, { groupId: "asc" }],
      take: L.groups,
      select: {
        role: true,
        group: {
          select: {
            id: true,
            name: true,
            visibility: true,
            members: { where: { role: "LEAD", ...linkedPersonVisible(viewer) }, select: { teamMember: { select: { id: true, name: true, initials: true } } } },
            _count: { select: { members: { where: linkedPersonVisible(viewer) } } },
            projects: { where: visible, select: { id: true, areaLinks: { where: { researchArea: visible }, select: { researchAreaId: true } } } },
          },
        },
      },
    }),
    prisma.groupMember.count({ where: myGroupsWhere }),

    prisma.researchArea.findMany({
      where: areasWhere,
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }, { id: "asc" }],
      take: L.areas,
      select: {
        id: true,
        icon: true,
        title: true,
        tag: true,
        visibility: true,
        researcherLinks: { where: mine, select: { teamMemberId: true } },
        _count: { select: { researcherLinks: { where: linkedPersonVisible(viewer) }, projectLinks: { where: { project: visible } } } },
      },
    }),
    prisma.researchArea.count({ where: areasWhere }),

    prisma.publication.findMany({ where: pubsWhere, orderBy: [{ year: "desc" }, { createdAt: "desc" }, { id: "asc" }], take: L.publications }),
    prisma.publication.count({ where: pubsWhere }),

    prisma.event.findMany({ where: eventsWhere, include: eventInclude, orderBy: eventOrderBy("upcoming"), take: L.events }),
    prisma.event.count({ where: eventsWhere }),

    prisma.newsItem.findMany({ where: newsWhere, orderBy: [{ sortDate: "desc" }, { id: "asc" }], take: L.news }),
    prisma.newsItem.count({ where: newsWhere }),

    // Collaborators: the OTHER researchers on the same visible projects / groups / areas. Only public
    // profile columns are selected (a TeamMember row has no visibility and these are the /team fields).
    prisma.projectMember.findMany({
      where: { teamMemberId: { not: me.id }, ...linkedPersonVisible(viewer), project: { ...visible, members: { some: mine } } },
      select: { projectId: true, teamMember: { select: { id: true, name: true, initials: true, role: true } } },
      take: COLLAB_SCAN,
    }),
    prisma.groupMember.findMany({
      where: { teamMemberId: { not: me.id }, ...linkedPersonVisible(viewer), group: { ...visible, members: { some: mine } } },
      select: { groupId: true, teamMember: { select: { id: true, name: true, initials: true, role: true } } },
      take: COLLAB_SCAN,
    }),
    prisma.researcherArea.findMany({
      where: { teamMemberId: { not: me.id }, ...linkedPersonVisible(viewer), researchArea: { ...visible, researcherLinks: { some: mine } } },
      select: { researchAreaId: true, teamMember: { select: { id: true, name: true, initials: true, role: true } } },
      take: COLLAB_SCAN,
    }),
  ]);

  // ---- Japanese overrides for everything named below: one batched lookup per entity type -------------
  const groupIds = new Set<string>([...projectRows.flatMap((r) => (r.project.group && canView(viewer, r.project.group.visibility) ? [r.project.group.id] : [])), ...groupRows.map((r) => r.group.id)]);
  const refs = await loadRefTranslations(locale, {
    areas: [...areaRows.map((a) => a.id), ...projectRows.flatMap((r) => r.project.areaLinks.map((l) => l.researchArea.id))],
    projects: projectRows.map((r) => r.project.id),
    groups: [...groupIds],
  });
  const projectTr = await loadTranslations(prisma, "RESEARCH_PROJECT", projectRows.map((r) => r.project.id), locale);

  const projects: WorkspaceProject[] = projectRows.map(({ role, project: raw }) => {
    const p = localize(raw, "RESEARCH_PROJECT", projectTr);
    const myRole = asProjectRole(role);
    return {
      id: p.id,
      title: p.title,
      summary: p.summary,
      status: asProjectStatus(p.status),
      ...visibilityField(viewer, p.visibility),
      group: p.group && canView(viewer, p.group.visibility) ? { id: p.group.id, name: pick(refs.group, p.group.id, "name", p.group.name) } : null,
      areas: p.areaLinks
        .map((l) => l.researchArea)
        .sort((a, b) => a.sortOrder - b.sortOrder || (a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : 1))
        .map((a) => toAreaRef({ ...a, title: pick(refs.area, a.id, "title", a.title) })),
      leads: p.members.map((m) => m.teamMember).sort(byText),
      memberCount: p._count.members,
      publicationCount: p._count.publications,
      upcomingEventCount: p._count.events,
      myRole,
      canManageMembers: canManageProjectMembers(viewer, myRole === "LEAD"),
    };
  });

  const groups: WorkspaceGroup[] = groupRows.map(({ role, group: g }) => {
    const myRole = asGroupRole(role);
    return {
      id: g.id,
      name: pick(refs.group, g.id, "name", g.name),
      ...visibilityField(viewer, g.visibility),
      leads: g.members.map((m) => m.teamMember).sort(byText),
      memberCount: g._count.members,
      projectCount: g.projects.length,
      areaCount: new Set(g.projects.flatMap((p) => p.areaLinks.map((l) => l.researchAreaId))).size,
      myRole,
      canManageMembers: canManageGroupMembers(viewer, myRole === "LEAD"),
    };
  });

  const areas: WorkspaceArea[] = areaRows.map((a) => ({
    ...toAreaRef({ ...a, title: pick(refs.area, a.id, "title", a.title) }),
    ...visibilityField(viewer, a.visibility),
    projectCount: a._count.projectLinks,
    researcherCount: a._count.researcherLinks,
    linked: a.researcherLinks.length > 0,
  }));

  // Knowledge: documents this researcher wrote or that belong to their projects, groups and areas (bounded, same visibility).
  // Resources (Phase 23): the same bounded shape, the same visibility, the same relationship definitions.
  const [publications, events, news, knowledge, resources] = await Promise.all([
    localizedPublications(pubRows, viewer, locale),
    serializeEvents(eventRows, viewer, locale),
    localizedNews(newsRows, viewer, locale),
    loadKnowledgeSection({ AND: [visible, { OR: researcherScope(viewer, me.id) }] }, viewer, locale, L.knowledge),
    loadResourceSection({ AND: [visible, { OR: resourceScope(viewer, me.id) }] }, viewer, locale, L.resources),
  ]);

  // ---- collaborators: distinct people, with how many DISTINCT projects/groups/areas they share --------
  const people = new Map<string, WorkspaceCollaborator & { p: Set<string>; g: Set<string>; a: Set<string> }>();
  const touch = (m: { id: string; name: string; initials: string; role: string }) => {
    let c = people.get(m.id);
    if (!c) {
      c = { id: m.id, name: m.name, initials: m.initials, role: m.role, sharedProjects: 0, sharedGroups: 0, sharedAreas: 0, p: new Set(), g: new Set(), a: new Set() };
      people.set(m.id, c);
    }
    return c;
  };
  for (const r of projectCollab) touch(r.teamMember).p.add(r.projectId);
  for (const r of groupCollab) touch(r.teamMember).g.add(r.groupId);
  for (const r of areaCollab) touch(r.teamMember).a.add(r.researchAreaId);
  const collaborators = [...people.values()]
    .map(({ p, g, a, ...c }) => ({ ...c, sharedProjects: p.size, sharedGroups: g.size, sharedAreas: a.size }))
    .sort((x, y) => y.sharedProjects + y.sharedGroups + y.sharedAreas - (x.sharedProjects + x.sharedGroups + x.sharedAreas) || byText(x, y));

  return {
    profile: { id: me.id, name: me.name, initials: me.initials, role: me.role },
    areas: { items: areas, total: areaTotal },
    projects: { items: projects, total: projectTotal },
    groups: { items: groups, total: groupTotal },
    publications: { items: publications, total: pubTotal },
    events: { items: events, total: eventTotal },
    news: { items: news, total: newsTotal },
    knowledge,
    resources,
    collaborators: { items: collaborators.slice(0, L.collaborators), total: collaborators.length },
  };
}

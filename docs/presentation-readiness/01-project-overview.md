# 01. Project overview

## What the website is
The Smart Computing Lab website is the lab's public face and its internal collaboration platform. Visitors read about research, people and publications. Lab members sign in to manage their profiles, add content, discuss, message each other and organise work. Lab managers and administrators curate content and manage accounts. Production: https://smartcomputinglab.vercel.app. Repository: `ShahRiarKhan55/smart-computing-lab-new`. The lab is at the Interdisciplinary Faculty of Science and Engineering, Shimane University (`apps/web/src/pages/ContactPage.tsx`).

## Objectives and users (VERIFIED from features and documentation; the original product requirements are not in the repository)
- Present research areas, projects, groups, people, alumni, publications, news, events and a gallery to the public.
- Give lab members a private area: profile, lab-only content, forum, messages, workspace, schedule.
- Let a small team run the site without developers: dashboard, visibility control, invitations, audit log, Japanese overrides.
- Serve English and Japanese readers.

| User | Account | Typical use |
|---|---|---|
| Visitor (guest) | none | read public pages, search |
| `MEMBER` | invitation by an administrator | edit own profile, add publications/news/events/knowledge/resources/gallery, forum, messages |
| `LAB_MANAGER` | role set by an administrator | content curation, visibility, projects and groups, moderation |
| `ADMIN` | role set by an administrator | everything, plus accounts, invitations, alumni |

## What makes it more than a static site
Server-side sessions and authentication; per-record visibility (public versus lab-only) enforced in the API; role-based access control; 38 database tables with relations; file upload and private file serving; an audit log; duplicate protection with locking; localisation of user content; an invitation workflow; optional Google sign-in for linked accounts. A static site could not hide records from guests, accept uploads, or let several people edit content safely.

## Feature inventory
Evidence for routes: [../technical/api-reference.md](../technical/api-reference.md) (141 routes). Permissions: [../technical/role-permissions.md](../technical/role-permissions.md). Frontend routes: `apps/web/src/App.tsx:100-230`. Models: `apps/server/prisma/schema.prisma`.

| Feature | Purpose / users | Frontend | Backend route file | Main models | Permission summary | Key limitation |
|---|---|---|---|---|---|---|
| Home | landing page, all | `pages/HomePage.tsx` | several read APIs | many | public | content is whatever is public |
| Research areas | themes, all | `ResearchPage`, `ResearchAreaDetailPage` | `research.routes.ts` | `ResearchArea`, `ResearcherArea` | read public; create/edit any member; delete manager | no pagination |
| Projects | work items | `ProjectsPage`, `ProjectDetailPage` | `projects.routes.ts` | `ResearchProject`, `ProjectMember`, `ProjectArea`, `ProjectPublication` | create manager; edit manager or project lead | list not paginated |
| Groups | research groups | `GroupsPage`, `GroupDetailPage` | `groups.routes.ts` | `ResearchGroup`, `GroupMember` | create manager; edit manager or lead | list not paginated |
| Team | roster by category, then Alumni | `TeamPage`, `MemberPage`, `TeamCard` | `team.routes.ts`, `member.routes.ts`, `alumni.routes.ts` | `TeamMember`, `HistoryEntry` | read public (published only); create manager; alumni admin only | Alumni publish flag is admin-only |
| Alumni | former members (last section of Team) | `TeamPage` | `alumni.routes.ts` | `TeamMember` (`category=ALUMNI`, `isPublished`) | published public; unpublished admin only | can never have an account |
| Publications | papers with metadata | `PublicationsPage`, `PublicationDetailPage`, `PublicationFormModal` | `publications.routes.ts` | `Publication`, `PublicationAuthor` | any member creates/edits; manager deletes | status not filterable; month not used for order |
| News | announcements | `NewsPage` | `news.routes.ts` | `NewsItem`, `NewsAuthor` | any member creates/edits; manager deletes | public immediately |
| Events | seminars, meetings | `EventsPage`, `EventDetailPage`, `SchedulePage` | `events.routes.ts` | `Event` | owner or manager edits | schedule is an embedded Google calendar |
| Knowledge base | documentation | `KnowledgePage`, `KnowledgeDetailPage` | `knowledge.routes.ts` | `KnowledgeDoc` | owner or manager edits | plain text body |
| Lab resources | datasets, hardware, software | `ResourcesPage`, `ResourceDetailPage` | `resources.routes.ts` | `LabResource`, `ResourceProject` | owner or manager edits | |
| Gallery | photos | `GalleryPage`, `GalleryUploadModal` | `gallery.routes.ts` | `GalleryItem`, `GalleryImage`, `StoredFile`, `GalleryUploadAttempt` | member uploads; owner or manager edits | EXIF not stripped; platform body limit |
| Forum | discussions | `pages/community/*` | `forum.routes.ts` | `ForumCategory/Post/Comment/Reaction/Mention/PostRevision` | read public categories; write members; moderate managers | plain text only |
| Messages and notifications | private chat | `MessagesPage`, `NotificationsPage` | `messages.routes.ts`, `notifications.routes.ts` | `Conversation`, `ConversationParticipant`, `Message`, `Notification` | participants only | no end-to-end encryption, no retention policy |
| Workspace | personal view | `WorkspacePage` | `workspace.routes.ts` | joins | signed in | |
| Search | site search | `SearchPage` | `search.routes.ts` | many | public, visibility-filtered | SQL `LIKE`, not full-text |
| Profile | own profile, photo, password, Google link | `ProfilePage` | `profile.routes.ts`, `auth.routes.ts`, `googleAuth.routes.ts` | `TeamMember`, `User`, `OAuthIdentity` | signed in | |
| Admin dashboard | management | `pages/admin/*` | `admin.routes.ts`, `users.routes.ts`, `invitations.routes.ts` | `User`, `AccountInvitation`, `AuditLog`, `Translation` | managers; accounts admin-only | |
| Invitations | account onboarding | `AdminPeoplePage`, `InvitePage` | `invitations.routes.ts` | `AccountInvitation` | admin creates; token holder accepts | |
| Localisation | EN/JA | `i18n/LocaleContext.tsx` | `translations.routes.ts` | `Translation` | managers edit overrides | skip link and some strings English-only |
| Help (`/docs`) | in-app guides | `pages/docs/*` | none (build-time content) | none | by guide audience | generated files must be re-rendered |
| SEO | sitemap, robots, JSON-LD | `hooks/useSeo.ts` | `sitemap.routes.ts` | none | public | sitemap needs `PUBLIC_BASE_URL` |

## Public versus authenticated; administrative versus ordinary
Public (no login): home, research, projects, groups, team and published alumni, publications, news, events, gallery, knowledge, resources, public forum categories, search, contact, help guides for visitors. Authenticated: profile, workspace, schedule, messages, notifications, creating anything, lab-only content. Administrative: `/admin/*` (manager), People & Accounts and invitations (admin only), alumni management (admin only). Ordinary members: everything else signed in.

## Honest note on scope
The original product requirements and decision records are not in the repository beyond the phase documents in `docs/architecture/`. "Why" statements in this report are engineering assessments unless a phase document says otherwise.

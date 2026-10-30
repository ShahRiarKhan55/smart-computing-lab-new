# Role and permission matrix

Source of truth: `packages/shared/src/permissions.ts` (pure policy functions, imported by both the API and the web app) and the route guards in `apps/server/src/routes/*.routes.ts`. The API enforces every rule; the web app only uses the same functions to decide which buttons to show. Tests: `npm run test:unit -w apps/server` (policy matrix), plus the HTTP regression suites listed in [testing.md](testing.md).

## Roles

| Role | How an account gets it | Summary |
|---|---|---|
| Guest | not signed in | Reads public content only. |
| `MEMBER` | an administrator invites the person or creates the account | Reads lab-only content, edits their own profile, creates content, owns what they create. |
| `LAB_MANAGER` | an administrator changes the role | Everything a member can do, plus content management: visibility, deletion, other people's profiles, projects, groups, moderation, the admin dashboard. **No account or role management. No alumni management.** |
| `ADMIN` | an administrator changes the role (nobody can change their own role) | Everything, including accounts, roles, invitations and alumni. |

There is no other role, and no "site owner" role inside the application. Site ownership means access to the Vercel and Turso dashboards, which are outside the app.

Visibility values on content: `PUBLIC` (everyone) and `LAB_ONLY` (signed-in accounts of any role).

## Matrix

`✓` allowed, `–` not allowed, "own" means the account that owns or authored the record.

### Reading

| Capability | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| View `PUBLIC` content | ✓ | ✓ | ✓ | ✓ |
| View `LAB_ONLY` content | – | ✓ | ✓ | ✓ |
| View **published** alumni | ✓ | ✓ | ✓ | ✓ |
| View **unpublished** alumni (Team page, `/api/alumni`, profile page) | – | – | – | ✓ |
| Workspace, messages, notifications, schedule (own data) | – | ✓ | ✓ | ✓ |

### Profiles and accounts

| Capability | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| Edit own profile text, photo, research links; change own password | – | ✓ | ✓ | ✓ |
| Edit another person's profile (not alumni) | – | – | ✓ | ✓ |
| Create a team profile (not alumni) | – | – | ✓ | ✓ |
| Change a profile's category and sort order | – | – | ✓ | ✓ |
| Create, edit, or move a profile into or out of the **Alumni** category | – | – | – | ✓ |
| Publish or unpublish an alumni profile | – | – | – | ✓ |
| Delete a team profile | – | – | – | ✓ |
| List, create, delete accounts; change roles; link or unlink an account and a profile | – | – | – | ✓ |
| Create and revoke researcher invitations | – | – | – | ✓ |

### Curated content (publications, news, research areas)

| Capability | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| Create | – | ✓ | ✓ | ✓ |
| Edit (any record, not only your own) | – | ✓ | ✓ | ✓ |
| Delete | – | – | ✓ | ✓ |
| Set or change visibility | – | – | ✓ | ✓ |
| Confirm a duplicate warning ("save anyway") | – | – | ✓ | ✓ |

New publications, news items and research areas default to `PUBLIC` when no visibility is given (see `visibility @default("PUBLIC")` in `prisma/schema.prisma`). Members cannot choose a visibility on these.

### Owned content (events, knowledge documents, lab resources, gallery items)

| Capability | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| Create | – | ✓ | ✓ | ✓ |
| Edit or delete | – | own only | ✓ | ✓ |
| Set visibility | – | – | ✓ | ✓ |

These default to `LAB_ONLY` until a manager or administrator publishes them. A record whose owner's account was deleted can only be changed by managers.

### Projects and groups

| Capability | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| Create a project or group | – | – | ✓ | ✓ |
| Edit one, and manage its members | – | if `LEAD` of it | ✓ | ✓ |
| Slug, sort order, group assignment, visibility | – | – | ✓ | ✓ |
| Delete | – | – | ✓ | ✓ |
| Link researchers to a research area | – | – | ✓ | ✓ |

New projects and groups default to `LAB_ONLY`.

### Forum, files, messages

| Capability | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| Read topics in a public category | ✓ | ✓ | ✓ | ✓ |
| Create topics, comment, react, mention | – | ✓ | ✓ | ✓ |
| Edit the text of a topic or comment | – | author only | author only | author only |
| Delete a topic or comment | – | own | ✓ | ✓ |
| Pin, lock, hide, move (moderation) | – | – | ✓ | ✓ |
| Create, edit, delete forum categories | – | – | ✓ | ✓ |
| Upload a file | – | ✓ | ✓ | ✓ |
| Read another account's private messages | – | – | – | – (nobody, including administrators) |

### Admin dashboard (`/admin`)

| Section | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| Overview, Research content (incl. bulk visibility), Events, Community, Files & Gallery, Localization | – | – | ✓ | ✓ |
| Audit log | – | – | ✓ (account events, actor emails, and alumni-related rows are hidden) | ✓ (everything) |
| People & Accounts (accounts, roles, invitations, linking) | – | – | – | ✓ |

The admin dashboard adds no powers: it is a management view over operations the ordinary routes already allow (`packages/shared/src/permissions.ts`, "admin / CMS" section).

### In-app documentation (`/docs`)

| Page | Who can open it |
|---|---|
| `/docs`, `/docs/quick-start`, `/docs/visitor`, `/docs/onboarding` | Everyone |
| `/docs/researcher` | Any signed-in account |
| `/docs/admin` | `LAB_MANAGER`, `ADMIN` |
| `/docs/maintenance` | `ADMIN` |

## Rules that are easy to get wrong

- **A lab manager cannot manage alumni.** Creating, editing, moving into or out of the Alumni category, and publishing or unpublishing are `ADMIN` only (`canManageAlumni`, `canPublishMember`). A manager sees exactly what the public sees on the Team page.
- **An alumni profile never has a login.** Linking an account to one, or moving a profile that has an account into Alumni, is refused with HTTP 409.
- **Unpublished profiles answer 404, not 403,** to everyone who may not see them, so their existence cannot be probed.
- **Any member can edit any publication, news item or research area.** Ownership only matters for events, knowledge documents, resources, gallery items, forum posts and comments.
- **Nobody can change their own role,** which guarantees at least one administrator remains.
- **Deleting an account keeps its team profile** (it becomes unlinked). Content the person created is kept without an owner.

## Needs verification

- The exact set of editable fields on another person's profile for a manager versus the owner is enforced in `routes/team.routes.ts` and `routes/profile.routes.ts`; this page documents the permission functions, not every field.

# Team and Alumni

Verified against `apps/web/src/pages/TeamPage.tsx`, `apps/web/src/App.tsx`, `apps/server/src/routes/team.routes.ts`, `alumni.routes.ts`, `apps/server/src/lib/memberVisibility.ts`, `alumni.ts` and `packages/shared/src/permissions.ts`.

## What the Team page shows

`/team` ("Our Team") lists current members in these sections, in this order, each with a count: **Faculty**, **PhD Students**, **MSc Students**, **BSc Students**, **Research Students**, and then **Alumni**. A section with no people is not shown. Every section uses the same profile card: photo (or initials), name linking to `/team/<id>`, role, department and any research links.

**Alumni is the last section, immediately after Research Students, on the same page.** There is no separate Alumni page and no Alumni item in the navigation menus.

- The legacy address `/alumni` redirects to `/team#alumni`; the page scrolls to the Alumni section once it has loaded.
- The Alumni section appears only when there is at least one alumni profile the viewer may see. With no published alumni, public visitors see no Alumni section at all.
- Alumni cards are loaded from `GET /api/alumni`. The other sections come from `GET /api/team`, which never includes alumni.

## Who sees which alumni

| Viewer | Published alumni | Unpublished alumni | Publish / Unpublish controls |
|---|:---:|:---:|:---:|
| Guest | ✓ | – | – |
| Member | ✓ | – | – |
| Lab manager | ✓ | – | – |
| Administrator | ✓ | ✓ (marked "Not published", with a note that only administrators can see it) | ✓ |

An unpublished alumni profile opened directly by URL answers "not found" (404) for everyone except an administrator. Unpublished profiles are also excluded from search, links on publication and project pages, and the sitemap.

## Administrator workflows

### Add an alumni profile

1. Sign in as an administrator and open **Team** (`/team`).
2. Click **+ Add team member** (the button appears for managers and administrators; only administrators are offered the Alumni category).
3. Fill in name, initials and role, and choose the category **Alumni**. The form explains that alumni profiles are created unpublished.
4. Save. The profile appears in the Alumni section for administrators only, marked **Not published**.

### Publish or unpublish

1. On the Team page, find the card in the Alumni section.
2. Click **Publish** (or **Unpublish**). A confirmation asks you to confirm only if the person has agreed to be listed.
3. The change applies to the very next request from any visitor. The badge shows **Published** or **Not published**.

### Edit or delete

- Administrators see the edit controls on alumni cards. Editing is the same form as for other members.
- Moving a profile **into or out of Alumni** is administrator-only.
- Deleting any team profile is administrator-only and irreversible ("Remove {name} from the team?"). The profile is removed together with its history entries and its links to publications, news, projects, groups and research areas; the publications and other records themselves are kept. A linked login account is kept and becomes unlinked.

## Rules enforced by the server

- Managers cannot create, edit, move, or publish alumni (HTTP 403, "Only an administrator can manage alumni profiles").
- Publication status can only change through `PUT /api/team/:id/publication`; a create or update body that contains `isPublished` is rejected with 400.
- An alumni profile can never have a login account. Linking one, inviting one, or moving a profile that has an account into Alumni returns 409. Unlink the account first.
- Existing non-alumni profiles are published by default; alumni are created unpublished.

## Other Team page behavior

- **Members** edit their own profile at **Account → My Profile**; managers and administrators can edit other profiles from the Team page.
- **Category** (Faculty, PhD, MSc, BSc, Research) and sort order are set by a manager or administrator.
- **Add team member** is visible to managers and administrators.

Design record: [`docs/architecture/phase3b-alumni-directory.md`](../architecture/phase3b-alumni-directory.md) (written when Alumni had its own page; where it differs from this page, this page and the code are current). Permissions: [role-permissions.md](../technical/role-permissions.md).

# Administrator Guide

**Audience:** lab administrators and lab managers.
**Purpose:** every administrative capability the site actually has, where to find it, and how to use it safely. Lab managers: see "What a lab manager can and cannot do" below; sections marked **ADMIN only** are not available to you.
**Prerequisites:** an ADMIN or LAB_MANAGER account (most of the admin dashboard; account/invitation management is ADMIN-only — see Roles below).

## Roles, in short

The app has exactly three roles: **MEMBER**, **LAB_MANAGER**, **ADMIN** (each strictly including the one before it, except for accounts). There is no separate "site owner" role inside the app — that is you, operating outside it, via the Vercel and Turso dashboards (see the Site Owner/Maintainer Guide).

| Capability | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|
| Own profile, own content | ✓ | ✓ | ✓ |
| Admin dashboard, content management, visibility, moderation | | ✓ | ✓ |
| Create projects and groups, edit other people's (non-alumni) profiles, delete content | | ✓ | ✓ |
| Accounts: invite, delete, change role, link to a profile | | | ✓ |
| Alumni: add, edit, publish, unpublish; see unpublished alumni | | | ✓ |
| Delete a team profile | | | ✓ |

The complete matrix is in the repository at `docs/technical/role-permissions.md`.

## What a lab manager can and cannot do

**Can:** open the admin dashboard (Overview, Research content, Events, Community, Files & Gallery, Localization, Audit log); change visibility of any record, including in bulk; delete publications, news items and research areas; create projects and groups and edit any project or group; create team profiles and edit other people's profiles in the Faculty, PhD, MSc, BSc and Research categories, including their category and sort order; confirm a duplicate warning ("save anyway"); moderate the forum and manage forum categories; edit or delete any member's events, knowledge documents, resources and gallery items; edit Japanese overrides.

**Cannot (ADMIN only):** invite or delete accounts, change roles, link accounts to profiles, see **People & Accounts**; create, edit, move, publish or unpublish **alumni** profiles (a manager sees exactly what the public sees, including on the Team page); delete a team profile. The server refuses these even if attempted directly. There is no approval queue: members' publications, news and research areas go live immediately, and managers correct or remove them afterwards.

## Admin login and dashboard

Sign in at `/login` with an ADMIN or LAB_MANAGER account, then open **Account → Admin Dashboard** in the header (also directly at `/admin`). The dashboard overview summarizes account and content counts at a glance. Its sections, in the left menu: **Overview**, **People & Accounts** (ADMIN only), **Research content**, **Events**, **Community**, **Files & Gallery**, **Localization** and **Audit log**.

## Researcher onboarding (invitations) — ADMIN only

**Where:** Admin Dashboard → **People & Accounts** (`/admin/people`).
**What it does:** invites a new researcher without ever setting, seeing, or receiving their password.
**Required permission:** ADMIN. LAB_MANAGER does not see this section at all, and the underlying API refuses it server-side even if attempted directly.

**Step by step:**

1. Open People & Accounts, click **Invite a researcher**.
2. Enter the researcher's email and choose their account role (Member / Lab manager / Admin).
3. Choose how their team profile is handled: link to an existing unlinked profile, create a brand-new one (name, initials, role/title, category), or no profile (an account-only login).
4. Click **Generate invitation link**. A dialog shows the one-time link — click **Copy link**.
5. Send that link to the researcher **privately** (email, chat, in person) — never post it anywhere public.
6. Close the dialog. **The link cannot be retrieved again** — this server never stores the raw link, only a one-way hash of it. If it's lost before the researcher receives it, revoke it and generate a new one.

**What to check afterward:** the **Pending & past invitations** list on the same page shows every invitation's status — Pending, Accepted, Expired or Revoked — who sent it, and when it expires. Once the researcher accepts, their account appears in the Accounts list above.

**Revoking:** click **Revoke** on any still-pending invitation to invalidate it immediately — use this if you sent it to the wrong address or it's no longer needed. A revoked or expired link cannot be un-revoked; generate a new invitation instead.

**Common mistakes:**
- Pasting the link somewhere semi-public (a shared channel, a ticket visible to others) — treat it exactly like a password.
- Inviting the same email twice while a first invitation is still pending — the system refuses this (revoke the first one, or wait for it to be used/expire).
- Expecting to see the researcher's password anywhere — by design, you never will, at any point.

**Security considerations:** every invitation token is a 256-bit random value; only its SHA-256 hash is ever stored; it is single-use and expires after 7 days; creating, revoking and accepting one are all recorded in the audit log without ever including the token itself.

## Managing existing accounts

Still on **People & Accounts** (`/admin/people`): the **Accounts** list shows every login, its role, and whether it's linked to a team profile.

- **Change role**: use the role dropdown on any account (not your own — you can't change your own role, which guarantees at least one admin always remains).
- **Link / unlink a team profile**: connect an existing login to an existing unlinked profile, or disconnect one (the profile itself is kept, just unlinked).
- **Delete an account**: removes the login only; its linked team profile (if any) is kept and becomes unlinked, not deleted.

## Content management

The admin dashboard's other sections are a management view over what managers can already do through the ordinary site — they add no extra power beyond what's listed in Roles above:

- **Research content** (`/admin/content`): a browsable overview across content types, with visibility controls (public/lab-only, including bulk changes).
- **Events** (`/admin/events`): manage lab events.
- **Community** (`/admin/community`): forum category management and moderation.
- **Files & Gallery** (`/admin/files`): manage uploaded files and gallery items.
- **Localization** (`/admin/translations`): manage Japanese overrides for translatable content.
- **Audit** (`/admin/audit`): the activity log — who did what, when. Account-level events (account created/deleted, role changed, invitation created/accepted/revoked) and the people's emails are visible to ADMIN only; rows about alumni or unpublished profiles are also hidden from managers; other audited actions are visible to any manager.

## Team members and Alumni

**Team page** (`/team`): sections appear in the order Faculty, PhD Students, MSc Students, BSc Students, Research Students, **Alumni**. Alumni is the last section of the same page; there is no separate Alumni page or menu item (`/alumni` redirects to `/team#alumni`). The Alumni section is hidden while no alumni are visible to the viewer.

**Add a team member (managers and administrators):** on the Team page click **+ Add team member**, fill in the form and choose a category. Managers can choose Faculty, PhD, MSc, BSc or Research; **only administrators are offered Alumni.**

**Add an alumni profile (ADMIN only):**

1. On `/team`, click **+ Add team member**.
2. Enter name, initials and role, and choose the category **Alumni**. Alumni profiles are created **unpublished** and can never have a login account.
3. Save. The card appears in the Alumni section for you only, marked **Not published**.
4. When the person has agreed to be listed, click **Publish** on their card and confirm. It is visible to the public on the next request. **Unpublish** reverses it at any time.

**Rules:** managers see only published alumni and cannot manage them; a profile that is linked to a login account cannot be moved into Alumni (unlink the account first); the publish state can only be changed with the Publish/Unpublish button.

**Delete a team profile (ADMIN only, irreversible):** removes the profile with its history entries and its links to publications, projects, groups and areas. The publications themselves and any linked login are kept (the login becomes unlinked).

## Publications and metadata

Any signed-in member can add or edit a publication; managers and administrators can delete it and choose its visibility. The form's **Publication Metadata** section has eight optional fields: **Status** (Published, Accepted, Under submission), **Paper category**, **Journal list number**, **Volume**, **Starting page**, **Ending page**, **Publication month** (1 to 12) and **Date of acceptance** (`YYYY-MM-DD`). Pages are whole numbers and the ending page cannot precede the starting page. Blank means "not stated" and is not shown to visitors. Accepted and Under-submission papers are not described to search engines as published. **Before adding a paper, search for it**: the same DOI is always refused, and the same title and year is refused unless a manager or administrator confirms it is a different paper.

## Destructive or irreversible actions

| Action | Who | Consequence |
|---|---|---|
| Delete an account | ADMIN | The login is removed; its team profile is kept (unlinked). The person needs a new invitation to return. |
| Delete a team profile | ADMIN | Profile, history and its links are removed. Cannot be undone from the site. |
| Delete a publication, news item or research area | manager, ADMIN | The record and its links are removed. |
| Revoke an invitation | ADMIN | The link stops working immediately and cannot be revived; create a new one. |
| Unpublish an alumni profile | ADMIN | The person disappears from the public Team page, search and links at once; reversible by publishing again. |
| Change a role | ADMIN | Takes effect on the person's next request. You cannot change your own role. |

There is no undo and no trash. For data recovery, see the site maintainer's backup notes (Turso point-in-time recovery).

## Account lifecycle, end to end

1. **Invite** (ADMIN) → 2. **Researcher accepts, chooses their own password** → 3. account is active, same as any other → 4. role changes and profile linking (ADMIN) as needed → 5. **delete** (ADMIN) when someone leaves — their team profile and any content they created are kept, simply no longer tied to a login.

## Safe handling of invitations — summary

- The invitation link is a credential. Treat it like a password: send it privately, never store it anywhere else, and revoke it if you're unsure it reached only the right person.
- You will never be shown, nor need to know, a researcher's password at any point — not at invitation, not afterward.
- If a researcher is locked out and has forgotten their password, there is currently no self-service reset — delete the old account and send a fresh invitation instead (see Known Limitations in the Site Owner/Maintainer Guide). There is no "deactivate" or "suspend" action; deleting is the only way to disable a login.
- The admin dashboard creates accounts only through invitations. (The API also has an endpoint that creates an account with an administrator-chosen password, `POST /api/users`; the dashboard does not use it, and you should prefer invitations so that you never know anyone's password.)

## Common problems

- **"Only an administrator can manage alumni profiles" (403).** A manager tried an alumni action. Ask an administrator.
- **"A profile with a login account can't be moved to Alumni" (409).** Unlink the account under People & Accounts first.
- **A page shows an error after a release.** Possibly a database migration has not been applied yet; tell the site maintainer (see the troubleshooting page in `docs/technical/troubleshooting.md`).

**Related documentation:** Researcher Onboarding Guide · Site Owner/Maintainer Guide

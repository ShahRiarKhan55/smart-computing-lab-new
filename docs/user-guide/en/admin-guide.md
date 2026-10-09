# Administrator Guide

**Audience:** lab administrators and lab managers.
**Purpose:** every administrative capability the site actually has, where to find it, and how to use it safely.
**Prerequisites:** an ADMIN or LAB_MANAGER account (most of the admin dashboard; account/invitation management is ADMIN-only — see Roles below).

## Roles, in short

The app has exactly three roles: **MEMBER**, **LAB_MANAGER**, **ADMIN** (each strictly including the one before it, except for accounts). There is no separate "site owner" role inside the app — that is you, operating outside it, via the Vercel and Turso dashboards (see the Site Owner/Maintainer Guide).

| Capability | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|
| Own profile, own content | ✓ | ✓ | ✓ |
| Admin dashboard, content management, visibility, moderation | | ✓ | ✓ |
| Accounts: invite, create, delete, change role | | | ✓ |

## Admin login and dashboard

Sign in at `/login` with an ADMIN or LAB_MANAGER account, then open **Account → Admin Dashboard** in the header (also directly at `/admin`). The dashboard overview summarizes account and content counts at a glance.

## Researcher onboarding (invitations) — ADMIN only

**Where:** Admin Dashboard → **People** (`/admin/people`).
**What it does:** invites a new researcher without ever setting, seeing, or receiving their password.
**Required permission:** ADMIN. LAB_MANAGER does not see this section at all, and the underlying API refuses it server-side even if attempted directly.

**Step by step:**

1. Open People, click **Invite a researcher**.
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

Still on **People** (`/admin/people`): the **Accounts** list shows every login, its role, and whether it's linked to a team profile.

- **Change role**: use the role dropdown on any account (not your own — you can't change your own role, which guarantees at least one admin always remains).
- **Link / unlink a team profile**: connect an existing login to an existing unlinked profile, or disconnect one (the profile itself is kept, just unlinked).
- **Delete an account**: removes the login only; its linked team profile (if any) is kept and becomes unlinked, not deleted.

## Content management

The admin dashboard's other sections are a management view over what managers can already do through the ordinary site — they add no extra power beyond what's listed in Roles above:

- **Content** (`/admin/content`): a browsable overview across content types, with visibility controls (public/lab-only, including bulk changes).
- **Events** (`/admin/events`): manage lab events.
- **Community** (`/admin/community`): forum category management and moderation.
- **Files** (`/admin/files`): manage uploaded files and gallery items.
- **Translations** (`/admin/translations`): manage Japanese overrides for translatable content.
- **Audit** (`/admin/audit`): the activity log — who did what, when. Account-level events (account created/deleted, role changed, invitation created/accepted/revoked) are visible to ADMIN only; other audited actions are visible to any manager.

## Publications discovered from ORCID, and the alumni directory

- **Review discovered publications** (lab managers and admins): on the Publications page choose **Review discovered publications**. Press **Check ORCID now** to read the public ORCID works of every current researcher who has an ORCID iD on their profile. Results land in **Waiting for review**; **nothing is public until you press Approve and publish**. You can correct the title, authors, venue and visibility first. Authors are required — they come from Crossref when the paper has a DOI, otherwise type them. **Reject** hides an item for good (it will not be proposed again). Items whose DOI is already in the lab list are filed under **Already in the lab list**.
- A check can finish as *partial*: researchers whose ORCID record could not be read (slow or unavailable service, wrong iD) are counted and the rest are still processed. Try again later. Only one check runs at a time.
- ORCID finds only what each person has made public on their own ORCID record, so it can miss papers; add those by hand. The site never scrapes Google Scholar or ResearchGate.
- **Alumni** (`/alumni`): add former members with the **Alumni** category. Alumni profiles never have a login — the system refuses to create an account, link one or send an invitation for them. Untick **Show this profile publicly** to hide the profile page, photo and listings (team, alumni, search, sitemap) from visitors. It does **not** remove the name where the person is explicitly linked as a project or group member or as a publication author, nor from free text such as an authors line; edit those links separately if the person must disappear entirely.
- **Google sign-in:** when it has been configured, the designated lab Google account can sign in with Google. Other Google accounts are refused unless an administrator has linked them. The password login keeps working either way.
- **Where does the copyright notice live?** In the footer and at `/copyright`. It is general wording and not legal advice.

## Account lifecycle, end to end

1. **Invite** (ADMIN) → 2. **Researcher accepts, chooses their own password** → 3. account is active, same as any other → 4. role changes and profile linking (ADMIN) as needed → 5. **delete** (ADMIN) when someone leaves — their team profile and any content they created are kept, simply no longer tied to a login.

## Safe handling of invitations — summary

- The invitation link is a credential. Treat it like a password: send it privately, never store it anywhere else, and revoke it if you're unsure it reached only the right person.
- You will never be shown, nor need to know, a researcher's password at any point — not at invitation, not afterward.
- If a researcher is locked out and has forgotten their password, there is currently no self-service reset — delete the old account (or leave it) and send a fresh invitation instead (see Known Limitations in the Site Owner/Maintainer Guide).

**Related documentation:** Researcher Onboarding Guide · Site Owner/Maintainer Guide

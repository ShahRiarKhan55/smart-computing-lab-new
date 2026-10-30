# Researcher / Lab Member Guide

**Audience:** researchers, students, faculty and other authenticated lab members.
**Purpose:** everything a signed-in member can do — your account, your profile, and the collaboration features available once you're logged in.
**Prerequisites:** an active lab account. If you don't have one yet, see "Account activation" below, or the separate Researcher Onboarding Guide.

## Account activation

Lab accounts are created only by an administrator — there is no public sign-up form. When an admin invites you, you receive a private link (`/invite/<token>`), valid for **7 days** and usable **only once**. Opening it shows your email address and a form to choose your own password; the administrator who invited you never sees, sets, or receives that password — you are the only person who ever knows it. Submitting the form activates your account and logs you in immediately. See the Researcher Onboarding Guide for the full walkthrough.

If your invitation link has expired or was already used, ask your administrator for a new one — your old link cannot be reused or extended.

## Logging in and out

Use **Log in** in the header (`/login`) with your email and password. **Log out** is in the Account menu once you're signed in. Sessions last about a week of inactivity; logging in again is always safe.

If the lab has switched on Google sign-in, the login page also offers it, but only for an account you have already linked: open **My Profile** while signed in with your password and connect your Google account there. Google can never create an account for you.

## Changing your password

On your **Profile** page (`/profile`), the **Password** section lets you change your own password at any time: enter your current password and your new one. This never involves the administrator — only you can change your own password this way, and only by first proving you know the current one. There is currently no self-service "forgot password" flow if you're logged out and don't remember your password — ask your administrator, who can delete the old account and send a fresh invitation (your team profile and the content you created are kept).

## Your profile

`/profile` shows your own team profile (if one is linked to your account — ask your admin if you don't have one yet) with an edit form for:

- Full name, initials, role/title, department, short bio
- A photo: upload an image (JPEG, PNG, WebP or GIF, up to 5 MB; photo metadata is removed automatically) or paste an external photo URL
- Links to your Google Scholar, ResearchGate and ORCID profiles (all optional)

**Category** (e.g. Faculty/PhD/MSc/BSc/Research) and your position in listings are set by a manager or admin, not by you — this keeps the roster's organization consistent. Your public profile (`/team/:id`) is visible to everyone, including guests, except for anything your profile links to that is itself marked lab-only.

## What you can edit vs. what needs an administrator

| You can do yourself | Needs a manager or admin |
|---|---|
| Edit your own profile fields | Change your account role |
| Change your own password | Create or delete accounts |
| Create or edit publications, news, research areas | Delete them, or change visibility (public/lab-only), or confirm a duplicate warning |
| Create events, knowledge documents, lab resources and gallery items, and edit/delete your own | Edit or delete another member's owned content |
| Edit a project or group only if you are its lead | Create projects or groups, change their settings, or edit other people's profiles |
| — | Add, edit or publish **alumni** profiles (administrators only) |
| Post, comment and react in the forum | Moderate the forum (pin/lock/hide/move/delete others' posts) |
| Message other members; manage your own notifications | — |

A **lab manager** has all of the above plus broader content management (visibility, deletion, project/group settings, moderation, the admin dashboard) — but never account/role management, which stays admin-only.

## Research & collaboration

- **Projects & Groups** (`/projects`, `/groups`): a lab manager or administrator creates them; a project or group **lead** can edit it and manage its own membership.
- **Workspace** (`/workspace`, signed-in only): a personal view of the projects, groups and research areas you're connected to.
- **Publications, News, Research Areas**: any signed-in member can add one.
- **Knowledge** (`/knowledge`): add documentation; edit or delete your own, or anything once you're a manager.
- **Resources** (`/resources`): add lab resources/infrastructure records; same ownership rule as Knowledge.
- **Events** (`/events`): create events; edit/delete your own.
- **Gallery** (`/gallery`): add photos; edit/delete your own.

**Check visibility before you save.** Publications, news items and research areas are **public immediately** (visible to guests); you cannot choose a different visibility, but a manager can change it afterwards. Events, knowledge documents, lab resources and gallery items start **lab-only** (visible to signed-in members only) until a manager or administrator publishes them.

**Duplicates.** When you add a publication, news item or research area that already exists (same DOI, or the same title and year), the site stops you with a duplicate warning. Search for the existing record and edit it instead. Only a manager or administrator can confirm that a near-duplicate is genuinely different; an identical DOI is always refused.

**Publications.** The Add/Edit Publication form has an optional **Publication Metadata** section (Status, Paper category, Journal list number, Volume, Starting page, Ending page, Publication month, Date of acceptance). Leave a box blank when the paper does not state it; blank values are not shown. Details: the Administrator Guide.

**Schedule.** Signed-in members also see **Schedule** in the header (`/schedule`), the lab's shared calendar.

## Community

- **Forum** (`/community/forum`): post topics, comment, and react in any category you can see. Editing your own post or comment is always available while it's yours; a manager may hide, lock, pin, move or delete content as part of moderation.
- **Messages** (`/messages`, signed-in only): private one-to-one conversations with other members. No one else — not even an admin — can read your messages.
- **Notifications** (`/notifications`): mentions, replies, reactions and similar activity addressed to you.

## Visibility & privacy rules, in short

- Content is **PUBLIC** (anyone, including guests) or **LAB_ONLY** (signed-in members only); only a manager/admin changes which.
- Your private messages are visible only to you and the other participant.
- Your profile shows only what you or a manager chose to fill in; anything it links to is still subject to that linked item's own visibility.

## Common problems

- **"No team profile is linked to your account yet."** Your login exists but isn't connected to a researcher profile — ask your administrator to link or create one.
- **A page says Forbidden (403).** You're logged in, but the action needs manager or admin permission (for example creating a project, or anything about alumni).
- **"Duplicate" warning when saving a publication.** It already exists; search for it and edit that record.
- **My invitation link doesn't work.** It has either already been used or has expired (7 days) — ask your administrator for a new one.

**Related documentation:** Quick Start Guide · Researcher Onboarding Guide · Public Visitor Guide

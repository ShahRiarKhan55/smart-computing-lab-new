# Researcher / Lab Member Guide

**Audience:** researchers, students, faculty and other authenticated lab members.
**Purpose:** everything a signed-in member can do — your account, your profile, and the collaboration features available once you're logged in.
**Prerequisites:** an active lab account. If you don't have one yet, see "Account activation" below, or the separate Researcher Onboarding Guide.

## Account activation

Lab accounts are created only by an administrator — there is no public sign-up form. When an admin invites you, you receive a private link (`/invite/<token>`), valid for **7 days** and usable **only once**. Opening it shows your email address and a form to choose your own password; the administrator who invited you never sees, sets, or receives that password — you are the only person who ever knows it. Submitting the form activates your account and logs you in immediately. See the Researcher Onboarding Guide for the full walkthrough.

If your invitation link has expired or was already used, ask your administrator for a new one — your old link cannot be reused or extended.

## Logging in and out

Use **Log in** in the header (`/login`) with your email and password. **Log out** is in the Account menu once you're signed in. Sessions last about a week of inactivity; logging in again is always safe.

## Changing your password

On your **Profile** page (`/profile`), the **Password** section lets you change your own password at any time: enter your current password and your new one. This never involves the administrator — only you can change your own password this way, and only by first proving you know the current one. There is currently no self-service "forgot password" flow if you're logged out and don't remember your password — ask your administrator, who can deactivate the old account and send a fresh invitation.

## Your profile

`/profile` shows your own team profile (if one is linked to your account — ask your admin if you don't have one yet) with an edit form for:

- Full name, initials, role/title, department, short bio, photo URL

**Category** (e.g. Faculty/PhD/MSc/BSc/Research) and your position in listings are set by a manager or admin, not by you — this keeps the roster's organization consistent. Your public profile (`/team/:id`) is visible to everyone, including guests, except for anything your profile links to that is itself marked lab-only.

## What you can edit vs. what needs an administrator

| You can do yourself | Needs a manager or admin |
|---|---|
| Edit your own profile fields | Change your account role |
| Change your own password | Create or delete accounts |
| Create publications, news, research areas | Delete most content, or change its visibility (public/lab-only) |
| Create events, knowledge documents, lab resources, gallery items you own, and edit/delete your own | Edit or delete another member's owned content |
| Post, comment and react in the forum | Moderate the forum (pin/lock/hide/move/delete others' posts) |
| Message other members; manage your own notifications | — |

A **lab manager** has all of the above plus broader content management (visibility, deletion, project/group settings, moderation, the admin dashboard) — but never account/role management, which stays admin-only.

## Research & collaboration

- **Projects & Groups** (`/projects`, `/groups`): any member can create a new project or group; a project or group **lead** can manage its own membership.
- **Workspace** (`/workspace`, signed-in only): a personal view of the projects, groups and research areas you're connected to.
- **Publications, News, Research Areas**: any signed-in member can add one.
- **Knowledge** (`/knowledge`): add documentation; edit or delete your own, or anything once you're a manager.
- **Resources** (`/resources`): add lab resources/infrastructure records; same ownership rule as Knowledge.
- **Events** (`/events`): create events; edit/delete your own.
- **Gallery** (`/gallery`): add photos; edit/delete your own.

New content you create defaults to **lab-only** visibility (visible to signed-in members, not to guests) unless a manager publishes it — this is deliberate: nothing you post is public by accident.

## Community

- **Forum** (`/community/forum`): post topics, comment, and react in any category you can see. Editing your own post or comment is always available while it's yours; a manager may hide, lock, pin, move or delete content as part of moderation.
- **Messages** (`/messages`, signed-in only): private one-to-one conversations with other members. No one else — not even an admin — can read your messages.
- **Notifications** (`/notifications`): mentions, replies, reactions and similar activity addressed to you.

## Visibility & privacy rules, in short

- Content is **PUBLIC** (anyone, including guests) or **LAB_ONLY** (signed-in members only); only a manager/admin changes which.
- Your private messages are visible only to you and the other participant.
- Your profile shows only what you or a manager chose to fill in; anything it links to is still subject to that linked item's own visibility.

## Your profile links, photo and publications

- **Research profile links.** On your profile page you can add an optional **Google Scholar** link, **ResearchGate** link and **ORCID iD**. They appear as small links under your name on your public profile and are hidden when empty. Only your own profile URLs are accepted (Scholar and ResearchGate links must be `https://` addresses on those sites; the ORCID iD is checked for typos).
- **Profile photo.** Use **Upload photo** to choose a JPEG, PNG or WebP file from your computer (up to 2 MB). The file is checked on the server; your previous photo is replaced only after the new one has been saved. You can also remove your photo.
- **Adding a publication.** Type the **DOI** by itself (for example `10.1234/example`) — a `doi:` prefix or a full `https://doi.org/…` link also works and is tidied for you. **Fill from DOI** looks the DOI up in Crossref and pre-fills the form; always check the details before saving. You can always type everything by hand instead.
- **Suggested publications.** If you enter your ORCID iD, a lab manager can check ORCID for works you have made public there. Nothing found this way appears on the site until a manager approves it. Papers that are not on your ORCID record will not be found; add them by hand.

## Common problems

- **"No team profile is linked to your account yet."** Your login exists but isn't connected to a researcher profile — ask your administrator to link or create one.
- **A page says Forbidden (403).** You're logged in, but the action needs manager or admin permission.
- **My invitation link doesn't work.** It has either already been used or has expired (7 days) — ask your administrator for a new one.

**Related documentation:** Quick Start Guide · Researcher Onboarding Guide · Public Visitor Guide

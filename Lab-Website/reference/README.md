# Smart Computing Lab Website

A simple, self-editable website for the lab. Built with plain HTML/CSS/JavaScript
on the frontend and PHP + SQLite on the backend — no frameworks, no build step,
no Node.js required. Works on almost any web host that supports PHP.

## What's inside

```
scl-php/
├── index.html              Homepage
├── login.html               Login page
├── profile.html              Your own editable profile (after logging in)
├── admin.html                 Admin dashboard (manage accounts) — admin only
├── pages/
│   ├── research.html        Research areas
│   ├── team.html             Team members
│   ├── publications.html      Publications
│   ├── news.html               News & events
│   └── contact.html             Contact info
├── css/                      Styles (don't need to touch these)
├── js/
│   └── app.js                  Shared login/logout logic — don't need to touch this
├── api/                       PHP backend — handles the database, don't need to touch these
├── data/
│   └── scl.sqlite              The database file (created automatically)
└── seed.php                   Run once to set up the admin account + starter content
```

## First-time setup

1. **Upload everything** to your web host via FTP, or place it in your local PHP
   server's folder. The host needs PHP 7.4+ with the `pdo_sqlite` extension —
   this is enabled by default on almost every host (shared hosting, university
   servers, etc.).

2. **Make the `data/` folder writable.** The database file lives there and PHP
   needs permission to create/update it. On most hosts:
   ```
   chmod 755 data/
   ```
   If you're not sure how, your host's support or control panel (cPanel, etc.)
   can usually set folder permissions for you.

3. **Run the seed script once**, either by visiting it in your browser:
   ```
   https://yoursite.com/seed.php
   ```
   or via terminal if you have SSH access:
   ```
   php seed.php
   ```
   This creates the database tables, an admin account, and some starter content
   so the site isn't empty.

4. **Log in as admin** at `https://yoursite.com/login.html` using:
   - Email: `admin@smartcomputinglab.org`
   - Password: `ChangeMe123!`

   ⚠️ **Change this password immediately.** There's no "change password" button
   yet — for now, the easiest way is to delete your account on the Admin
   dashboard and re-create it with a new password (or ask whoever set up the
   site to update it directly in the database). A proper "change my password"
   feature is a natural thing to add later if useful.

5. **Delete or restrict `seed.php`** once you're done — it's safe to leave (it
   won't overwrite existing data), but it's good practice to remove it from
   the live site afterward, or rename it to something private.

## How logins work

- **You (admin)** can edit everything: team profiles, publications, news, and
  research areas — including deleting any of them — plus create login
  accounts for other lab members.
- **Lab members** log in and can:
  - Edit their own team profile (name, role, department, bio, photo) — they
    can't change their category (Faculty/PhD/MSc/BSc/Research) or touch
    anyone else's profile; only you can do that.
  - **Add and edit** Research Areas, Publications, and News items — same as
    admin for these three sections.
  - They **cannot delete** Research Areas, Publications, or News — deleting
    those stays admin-only, so nothing important disappears by accident.

### Adding a new lab member

1. Log in as admin, go to **Admin dashboard** (`admin.html`).
2. Click **"+ Create login for a member"**.
3. Fill in their email and a temporary password, and either:
   - Link the account to an existing team member who doesn't have a login yet, or
   - Create a brand new team profile for them on the spot.
4. Give them the email + temporary password — they can log in at `login.html`
   and start editing their profile right away.

### Editing content directly on each page

When you're logged in, every page (Research, Team, Publications, News)
shows small pencil (✎) icons on each card, plus a "+ Add" button at the top.
Click to edit inline — no need to touch any code. Delete (✕) icons only
show up for admins, so members can't accidentally remove content.

### Member profile pages

Clicking any team member's card on the Team page opens their own profile
page (`pages/member.html?id=...`), which shows:
- their bio
- a "History" timeline (e.g. "2023 — Joined the lab")
- the publications and news items they've linked to themselves

If you're logged in as that member (or as admin), you'll see extra buttons
at the top of their profile to edit the bio, add/edit/delete history entries,
and pick which existing publications/news belong to them via a checklist.

## Moving to a real domain

Since this uses SQLite (a single file database), there's nothing extra to set
up — just upload the whole folder to your new host and run `seed.php` once
(it'll skip creating duplicate data if the database already has content from
testing). Just make sure to:

- Copy the `data/scl.sqlite` file along with everything else if you want to
  keep your existing content, **or** run `seed.php` fresh on the new host if
  you want to start clean.
- Make sure `data/` is writable on the new host (see step 2 above).

## A note on Google Fonts

The pages link to Google Fonts (Space Mono + DM Sans) for the lab's look. This
will load automatically once the site is live on a normal web host — no
action needed.

## Troubleshooting

**"Database is not writable" type errors:** the `data/` folder needs write
permission (`chmod 755 data/` or check with your host).

**Login doesn't seem to "stick" between pages:** PHP sessions need cookies
enabled in the browser, and the site needs to be accessed via a consistent
URL (not sometimes `www.` and sometimes not) — most hosts handle this
automatically.

**Lost the admin password:** Re-run `seed.php` after first deleting the admin
row from the database, or ask a developer to reset the password hash directly
via a short PHP snippet using `password_hash()`.

# 19. Live demonstration guide (12 to 15 minutes)

## Before you start
- **Use production for public pages only.** For member, manager and administrator views, run a **local copy** (`npm run dev`, a disposable database, fake data) or prepare screenshots. Never type a real password on screen, never open People & Accounts or the Audit log on production in front of an audience (they show real emails), and never open `/admin` pages that list real people.
- Create demo accounts locally with fake emails (for example `member@example.org`) using the disposable-database approach described in `docs/technical/development-setup.md`. The seed script's default administrator is for local use only.
- Close other tabs, disable password-manager pop-ups, zoom to 125 percent, and rehearse once. Have this plan and [21-quick-reference.md](21-quick-reference.md) open on a second screen.
- Prepare a fallback: screenshots of each step in case the network fails.

## Plan
| Time | Step | Click | Say | Do not show |
|---|---|---|---|---|
| 0:00 to 1:00 | Opening | production home page | "This is the lab's website and members' platform. It is a real web application with accounts and permissions, not a static page." One sentence on who it is for | browser bookmarks, dashboards |
| 1:00 to 3:00 | Public pages | **Research** menu: Research Areas, Projects; **People**: Groups | Public pages need no login; content is filtered on the server by visibility | lab-only items (you will not see them as a guest) |
| 3:00 to 4:30 | Team and Alumni | **People, Team** (`/team`): point out sections Faculty, PhD, MSc, BSc, Research, then **Alumni** last; open a profile; show the research-link logos | "Alumni appear only after an administrator publishes them; they never have accounts." Visit `/alumni` to show the redirect to `/team#alumni` | personal data beyond what is already public |
| 4:30 to 5:30 | Publications | **Research, Publications**; open one with metadata (status, volume, pages) | "Eight optional metadata fields; blank values are simply not shown." | |
| 5:30 to 6:30 | Language | language switcher in the header | "Whole interface in English and Japanese; user content can carry Japanese text too." | |
| 6:30 to 8:00 | Authentication (local copy) | **Log in** with a demo member | "Passwords are hashed, sessions are server-side cookies, accounts are created by invitation." Mention optional Google sign-in for linked accounts | real credentials |
| 8:00 to 9:30 | Member experience | **Account, My Profile**: edit bio, upload a profile photo; show Workspace, Messages, Forum | "Members add content; what they cannot do is edit others' profiles, create projects or see admin pages" | real photos |
| 9:30 to 10:30 | Lab manager (local) | sign in as a demo manager; **Account, Admin Dashboard**; Research content with visibility toggle | "Managers curate and set visibility; they cannot manage accounts or alumni" | |
| 10:30 to 12:00 | Administrator (local) | **People & Accounts**: invitation workflow (do not copy the link on screen); on `/team` publish and unpublish a demo alumnus | "Admins manage accounts, roles and alumni; every action is audited" | invitation links, real emails |
| 12:00 to 13:30 | Security and permissions | try `/admin` as a member (redirect); show the permission matrix page (`docs/technical/role-permissions.md`) | "The server enforces permissions; hiding a button is only courtesy" | any secrets or environment variables |
| 13:30 to 14:30 | Closing | return to the home page | Summarise: real platform, role-based access, bilingual, tested, honest limitations; invite questions | |

## Live safety rules
- Do not demonstrate attacks. If someone asks you to "try to hack it", decline politely and offer to explain the controls and the audit instead.
- If something breaks, say what you expect to see, show the screenshot, and continue.
- Keep answers short; use the [question bank](18-presentation-qa.md) for the rest.

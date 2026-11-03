# 06. Authentication and authorization

## Account lifecycle
| Topic | Actual behavior | Status / evidence |
|---|---|---|
| Registration | **None for the public.** Accounts exist only because an administrator created them: normally an invitation (`POST /api/invitations`, token link `/invite/<token>`), or the API-only `POST /api/users`. | VERIFIED: `users.routes.ts:19`, `invitations.routes.ts` |
| Invitation token | 256-bit random value, only its SHA-256 hash is stored, single use, 7-day expiry, the invitee chooses the password (the administrator never sees it) | VERIFIED: `lib/invitationToken.ts:25-30`, `invitations.routes.ts:27` |
| Login | `POST /api/auth/login`; email lower-cased; same message for unknown email and wrong password; bcrypt compared against a dummy hash for unknown emails to equalise timing | VERIFIED: `auth.routes.ts:16-60` |
| Password storage | bcrypt cost 10 (`bcryptjs`); minimum 8 characters, UTF-8 byte maximum, no complexity or breach check | VERIFIED: `auth.routes.ts:16,90`; `schemas/user.ts:17,30-33` |
| Logout | `POST /api/auth/logout` destroys the session row and clears the cookie; no CSRF check on it | VERIFIED: `auth.routes.ts:109-114` |
| Session | `express-session` with a database store (table `Session`: `id`, `data`, `expiresAt`); cookie `scl.sid`; `HttpOnly`; `SameSite=Lax`; `Secure` in production; 7-day lifetime, **rolling** (renewed on activity); `saveUninitialized: false` | VERIFIED: `lib/session.ts:36-50`; `schema.prisma:45-51` |
| Session fixation | session id regenerated on login, on password change and on Google sign-in | VERIFIED: `auth.routes.ts:54,100`, `googleAuth.routes.ts` |
| Session secret | required in production, startup fails without it; development default with a warning | VERIFIED: `lib/session.ts:13-21` |
| Password reset | **NOT IMPLEMENTED** (no email service). Workaround: an administrator deletes the account and re-invites. | VERIFIED |
| Multi-factor authentication | **NOT IMPLEMENTED** | VERIFIED (no code) |
| Duplicate email | `User.email` is unique; invitations refuse a second pending invitation for the same email | VERIFIED: `schema.prisma:64`; admin guide |
| Identity linking | a team profile links to at most one account (`TeamMember.userId` unique, `SetNull`); alumni profiles can never have accounts | VERIFIED: `lib/alumni.ts`, `users.routes.ts:152-180` |
| Account deletion | admin only, not yourself; the team profile is kept and unlinked; audit row written | VERIFIED: `users.routes.ts:183-214` |
| Role assignment | admin only; nobody can change their own role | VERIFIED: `permissions.ts` `roleChangeError` |
| Session invalidation | role and existence are re-read from the database on **every** request, so a deleted user or a downgraded role takes effect immediately. **There is no way to revoke a user's other sessions** (no `userId` column on `Session`; nothing deletes sessions by user). A password change regenerates only the current session. | VERIFIED: `middleware/auth.ts:11-24`; search for session deletion found only expiry cleanup |
| Rate limiting | login and password change: 10 failures per 15 minutes per (client IP, email), in memory, per serverless instance; Google start and invitation endpoints have their own per-IP limiters | VERIFIED: `lib/loginRateLimit.ts:20-21`; limits degrade across instances (F-03) |
| Auth error handling | 401 for guests, 403 for insufficient role, 404 where existence must not leak, 429 for rate limit | VERIFIED |

## Google OAuth (implemented, optional)
Enabled only when `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_OAUTH_REDIRECT_URI` are all set and valid (otherwise the login page is unchanged). It **never creates an account**. Sign-in looks up `OAuthIdentity` by `(provider, subject)`, not by email (`googleAuth.routes.ts:261-330`), so a Google account with a matching email cannot take over an existing account. Protections verified in code: single-use transaction stored in the session, `state` compared with `timingSafeEqual` (`:293`), PKCE verifier, nonce checked in the ID token, token verified by `google-auth-library`, session regenerated, per-IP start limiter, linking requires re-entering the password and a same-origin check (`:220-260`), fixed post-login redirect (no open redirect), failures logged as short reason codes (no tokens). Unlinked Google accounts get "not linked" and nothing is written.

## Who can do what (permission matrix)
The authoritative, source-derived matrix is [../technical/role-permissions.md](../technical/role-permissions.md). Condensed:

| Feature | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|:---:|:---:|:---:|:---:|
| Read public content, published alumni, search | ✓ | ✓ | ✓ | ✓ |
| Read lab-only content | – | ✓ | ✓ | ✓ |
| See unpublished alumni | – | – | – | ✓ |
| Own profile, photo, password | – | ✓ | ✓ | ✓ |
| Edit others' (non-alumni) profiles; category and order | – | – | ✓ | ✓ |
| Create team profile (non-alumni) | – | – | ✓ | ✓ |
| Alumni: create, edit, move, publish, unpublish | – | – | – | ✓ |
| Delete a team profile | – | – | – | ✓ |
| Publications, news, research areas: create and edit | – | ✓ | ✓ | ✓ |
| Same: delete, set visibility, confirm duplicate | – | – | ✓ | ✓ |
| Events, knowledge, resources, gallery: create | – | ✓ | ✓ | ✓ |
| Same: edit or delete | – | own | ✓ | ✓ |
| Projects, groups: create / delete | – | – | ✓ | ✓ |
| Projects, groups: edit | – | lead only | ✓ | ✓ |
| Forum: write and react | – | ✓ | ✓ | ✓ |
| Forum: moderate, manage categories | – | – | ✓ | ✓ |
| Private messages (own) | – | ✓ | ✓ | ✓ (no admin can read others') |
| Admin dashboard (content, files, events, community, localisation) | – | – | ✓ | ✓ |
| Audit log | – | – | ✓ (account and alumni rows hidden) | ✓ |
| Accounts, roles, invitations, linking | – | – | – | ✓ |
| Upload files | – | ✓ | ✓ | ✓ |

## Where permissions are checked
Backend: yes, for every state-changing route (guards listed in doc 05 and `api-reference.md`). Frontend: also (`usePolicy`, `ProtectedRoute`), cosmetic only. Both: yes. Frontend only: no route was found that relies only on the UI. **PARTIALLY VERIFIED**: all 141 routes were classified from their guards, but not every handler body was read line by line.

## What happens when (VERIFIED unless stated)
| Situation | Result |
|---|---|
| Guest opens a protected page | `ProtectedRoute` redirects to `/login`; protected API calls answer 401 |
| Member opens `/admin` or an admin API | UI redirects to `/`; API answers 403 |
| Lab manager attempts an admin-only action (accounts, alumni) | 403 (`canManageUsers`, `canManageAlumni`); the people page is hidden in the UI |
| Admin accesses unpublished content | allowed: `seesUnpublishedMembers` is admin only (`memberVisibility.ts:20-24`); managers do not see it |
| Role changes during an active session | next request uses the new role (role is read from the database each time) |
| User deleted while sessions exist | `getSessionUser` returns no user, so the session behaves as a guest; the orphan `Session` row stays until expiry |
| Password changed | current session id replaced; **other sessions of that user stay valid** (F-01) |
| Member edits another member's profile id | 403 (unknown id also 403 so ids cannot be probed, `auth.ts:73-79`) |
| Member requests another's conversation | 404 (`messages.routes.ts:28-37`) |

## Risks found
Privilege escalation: none found in the guards reviewed. IDOR: `requireOwnerOrManager`, file and conversation checks behave correctly. Inconsistency: policy allows any member to edit any publication, news item or research area (by design). Session fixation: mitigated. Details and severities: [07-security-audit.md](07-security-audit.md).

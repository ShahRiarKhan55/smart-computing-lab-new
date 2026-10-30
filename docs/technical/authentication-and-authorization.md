# Authentication and authorization

## Accounts and sign-in

- **There is no public sign-up.** Accounts exist only because an administrator created them (normally through an invitation).
- **Password sign-in:** `POST /api/auth/login` with email and password. Passwords are hashed with bcrypt (cost 10). A fixed dummy hash is compared when the email is unknown so response time does not reveal whether an account exists. A new password must be at least 8 characters.
- **Session:** `express-session` with a Prisma-backed store (table `Session`, `apps/server/src/lib/prismaSessionStore.ts`). Cookie `scl.sid`: HttpOnly, SameSite=Lax, `Secure` in production, a one-week maximum age that is renewed on activity (`rolling: true`). The session id is regenerated on login and on password change.
- **Change password:** `POST /api/auth/password` (signed in; current password required). The profile page has the form. There is **no "forgot password" flow** and no email delivery; the workaround is for an administrator to delete the account and send a new invitation.
- **Rate limiting:** login and password-change attempts are limited per IP and email (10 attempts per 15 minutes), invitation lookups per IP. The limiter is in memory per process, so on Vercel each function instance has its own counter.
- **Google sign-in (optional):** enabled only when `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_OAUTH_REDIRECT_URI` are all set and valid. It never creates an account: a signed-in user links their Google account from their profile, after which it can be used to sign in to that same account. Authorization-code flow with PKCE, state and nonce. When not configured, the login page is unchanged. Design record: [`docs/architecture/phase2-2-google-linking-and-signin.md`](../architecture/phase2-2-google-linking-and-signin.md).

## Invitations (how accounts are created in practice)

An administrator creates an invitation in **Admin Dashboard → People & Accounts** (`POST /api/invitations`). The response contains a one-time link `/invite/<token>`. The token is 256 bits of randomness, only its SHA-256 hash is stored, it is single-use and expires after 7 days. The invitee opens the link and chooses their own password; the administrator never sees or sets it. Creating, revoking and accepting invitations are written to the audit log without the token. Full workflow: [administrator guide](../user-guide/en/admin-guide.md).

## Authorization architecture

1. **Policy functions** in `packages/shared/src/permissions.ts` (for example `canManageAlumni`, `canEditProject`) are pure functions of the acting account.
2. **API guards** in `apps/server/src/middleware/auth.ts`:
   - `optionalAuth` loads the session user if there is one (public endpoints that filter by viewer);
   - `requireAuth` answers 401 without a session;
   - `requireCan(check)` answers 401 or 403 unless the policy function allows the actor;
   - `requireOwnerOrManager(param)`, `requireEditor(...)` and similar helpers add ownership checks.
3. **Handlers re-check ownership and visibility** against the stored record (for example an event's `createdById`).
4. **The web app** calls the same policy functions through `apps/web/src/auth/usePolicy.ts` and `ProtectedRoute` to hide controls. That is cosmetic: a request that bypasses the UI meets the same API checks.

Every policy function fails closed: an unknown role grants nothing beyond "is signed in". The complete matrix is in [role-permissions.md](role-permissions.md).

## Visibility model

- Records are `PUBLIC` or `LAB_ONLY`. Guests receive only `PUBLIC` data; any signed-in account also receives `LAB_ONLY`.
- Team profiles have a second switch, `TeamMember.isPublished`. Only `true` is public. Alumni profiles are created unpublished and only an administrator can publish them. Administrators see every profile; **lab managers see exactly what the public sees**. Details: [content-management/team-and-alumni.md](../content-management/team-and-alumni.md).
- Hidden records answer 404 rather than 403.

## Security headers and proxy trust

`apps/server/src/lib/security.ts` sets Helmet-based headers and a Content-Security-Policy for the single-origin app. `TRUST_PROXY` (0 or 1) controls whether `X-Forwarded-For` is trusted; production on Vercel uses `1`. The app refuses to start in production without a real `SESSION_SECRET`, and refuses to start with only one of the two Turso variables set.

## Needs verification

- Behavior of the in-memory limiter under multiple Vercel instances has not been measured; treat it as best effort.

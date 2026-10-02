import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  canManageInvitations,
  createInvitationSchema,
  acceptInvitationSchema,
  invitationTokenSchema,
  type InvitationStatus,
  type InvitationSummary,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { requireCan } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { assertValidId } from "../lib/authorLinks.js";
import { recordAudit } from "../lib/audit.js";
import { generateInvitationToken, hashInvitationToken } from "../lib/invitationToken.js";
import { isInvitationRateLimited, recordInvitationAttempt } from "../lib/invitationRateLimit.js";
import { normalizeBaseUrl } from "../lib/sitemap.js";

const router = Router();

const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days (fixed per the approved design — not env-configurable)

function statusOf(row: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }): InvitationStatus {
  if (row.usedAt) return "ACCEPTED";
  if (row.revokedAt) return "REVOKED";
  if (row.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return "PENDING";
}

function invitationUrl(req: { protocol: string; get(name: string): string | undefined }, token: string): string {
  const base = normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
  if (base) return `${base}/invite/${token}`;
  // No PUBLIC_BASE_URL configured (e.g. local dev): fall back to a path-only link. Still copyable
  // and usable from the same origin the admin is already on; just not shareable cross-origin.
  return `/invite/${token}`;
}

// ---------------------------------------------------------------------------
// ADMIN-ONLY: create / list / revoke. All account-management, so ADMIN only —
// see canManageInvitations in @scl/shared (LAB_MANAGER is deliberately excluded,
// matching every other account-adjacent permission).
// ---------------------------------------------------------------------------

// GET /api/invitations -> all invitations, newest first. Never includes a token or its hash.
router.get(
  "/",
  requireCan(canManageInvitations),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.accountInvitation.findMany({
      orderBy: { createdAt: "desc" },
      include: { invitedBy: { select: { email: true } } },
    });

    const teamMemberIds = [...new Set(rows.map((r) => r.teamMemberId).filter((id): id is string => id !== null))];
    const teamMembers = teamMemberIds.length
      ? await prisma.teamMember.findMany({ where: { id: { in: teamMemberIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(teamMembers.map((m) => [m.id, m.name]));

    const summaries: InvitationSummary[] = rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role as InvitationSummary["role"],
      teamMemberId: r.teamMemberId,
      teamMemberName: r.teamMemberId ? (nameById.get(r.teamMemberId) ?? null) : null,
      status: statusOf(r),
      invitedByEmail: r.invitedBy.email,
      expiresAt: r.expiresAt.toISOString(),
      usedAt: r.usedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    res.json(summaries);
  }),
);

// POST /api/invitations -> create a new invitation. Deliberately has no password field anywhere
// in this handler (see createInvitationSchema): the admin chooses an email, a role and optionally
// a team-profile link, and nothing else. The raw token is returned ONCE, here, in `url` — never
// stored, never logged, never put in audit details (recordAudit itself would throw if it were:
// its FORBIDDEN_KEY check blocks any detail key containing "token").
router.post(
  "/",
  requireCan(canManageInvitations),
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(createInvitationSchema, req.body);

    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const created = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (existingUser) throw new HttpError(409, "An account with that email already exists.");

      const existingPending = await tx.accountInvitation.findFirst({
        where: { email: body.email, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (existingPending) throw new HttpError(409, "There is already a pending invitation for that email. Revoke it before sending a new one.");

      if (body.teamMemberId) {
        const member = await tx.teamMember.findUnique({ where: { id: body.teamMemberId }, select: { userId: true } });
        if (!member) throw new HttpError(400, "Selected team member does not exist.");
        if (member.userId) throw new HttpError(409, "That team member already has a linked account.");
      }

      const invitation = await tx.accountInvitation.create({
        data: {
          tokenHash,
          email: body.email,
          role: body.role,
          teamMemberId: body.teamMemberId ?? null,
          name: body.name ?? null,
          initials: body.initials ?? null,
          memberRole: body.memberRole ?? null,
          category: body.category ?? null,
          invitedById: req.user!.id,
          expiresAt,
        },
      });

      await recordAudit(tx, {
        actor: req.user!,
        action: "INVITATION_CREATED",
        entityType: "ACCOUNT_INVITATION",
        entityId: invitation.id,
        details: { email: invitation.email, role: invitation.role },
      });

      return invitation;
    });

    res.status(201).json({
      id: created.id,
      email: created.email,
      role: created.role,
      status: statusOf(created) satisfies InvitationStatus,
      expiresAt: created.expiresAt.toISOString(),
      // The one and only time the raw link is ever available. The admin must copy it now and send
      // it privately to the researcher — it cannot be retrieved again (see GET / above, which
      // never includes it) and this server never stores it.
      url: invitationUrl(req, rawToken),
    });
  }),
);

// DELETE /api/invitations/:id -> revoke a still-pending invitation. A conditional update (not a
// plain update), so it can only ever affect a row that is still genuinely pending — accepting and
// revoking can never race into an inconsistent state, and revoking twice is a clear no-op error.
router.delete(
  "/:id",
  requireCan(canManageInvitations),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.accountInvitation.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      if (statusOf(existing) !== "PENDING") throw new HttpError(409, "Only a pending invitation can be revoked.");

      const revoked = await tx.accountInvitation.updateMany({
        where: { id: existing.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) throw new HttpError(409, "Only a pending invitation can be revoked.");

      await recordAudit(tx, {
        actor: req.user!,
        action: "INVITATION_REVOKED",
        entityType: "ACCOUNT_INVITATION",
        entityId: existing.id,
        details: { email: existing.email },
      });
    });

    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// PUBLIC: the researcher's own side, authenticated only by possession of the raw token (never a
// logged-in session — the whole point is that no account exists yet). Both endpoints are
// rate-limited by IP (lib/invitationRateLimit.ts) as defense-in-depth; the 256-bit token itself is
// already infeasible to brute-force.
// ---------------------------------------------------------------------------

// GET /api/invitations/token/:token -> whether this link is still usable, and the email it was
// issued to (so the setup page can say "Activate your account, name@example.org" without the
// researcher having to type their own email). Never reveals the role, the inviting admin, or
// anything about OTHER invitations.
router.get(
  "/token/:token",
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (isInvitationRateLimited(ip)) throw new HttpError(429, "Too many requests. Please wait a few minutes and try again.");
    recordInvitationAttempt(ip);

    const token = parseOrThrow(invitationTokenSchema, req.params.token);
    const row = await prisma.accountInvitation.findUnique({ where: { tokenHash: hashInvitationToken(token) } });

    if (!row || statusOf(row) !== "PENDING") {
      res.json({ valid: false, email: null });
      return;
    }
    res.json({ valid: true, email: row.email });
  }),
);

// POST /api/invitations/token/:token/accept { password } -> creates the account (and, per the
// invitation's stored mode, links or creates the team profile — same three modes as
// POST /api/users), marks the invitation used, and logs the new account in exactly like
// POST /api/auth/login does (session regenerated, same cookie). The admin is never involved in
// this request at all.
router.post(
  "/token/:token/accept",
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (isInvitationRateLimited(ip)) throw new HttpError(429, "Too many requests. Please wait a few minutes and try again.");
    recordInvitationAttempt(ip);

    const token = parseOrThrow(invitationTokenSchema, req.params.token);
    const { password } = parseOrThrow(acceptInvitationSchema, req.body);
    const tokenHash = hashInvitationToken(token);

    const row = await prisma.accountInvitation.findUnique({ where: { tokenHash } });
    if (!row) throw new HttpError(400, "This invitation link is invalid.");
    const status = statusOf(row);
    if (status === "ACCEPTED") throw new HttpError(409, "This invitation has already been used. Please log in instead.");
    if (status === "REVOKED") throw new HttpError(410, "This invitation has been revoked. Ask your administrator for a new one.");
    if (status === "EXPIRED") throw new HttpError(410, "This invitation has expired. Ask your administrator for a new one.");

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      // Re-check everything that could have changed since the invitation was created (another
      // request accepting the same token concurrently, the email registered some other way, the
      // linked team member claimed elsewhere) — the same conditional-write discipline as
      // POST /api/users and PUT /api/users/:id/link.
      const current = await tx.accountInvitation.findUnique({ where: { id: row.id } });
      if (!current || statusOf(current) !== "PENDING") throw new HttpError(409, "This invitation is no longer valid.");

      const existingUser = await tx.user.findUnique({ where: { email: current.email }, select: { id: true } });
      if (existingUser) throw new HttpError(409, "An account with that email already exists. Please log in instead.");

      if (current.teamMemberId) {
        const member = await tx.teamMember.findUnique({ where: { id: current.teamMemberId }, select: { userId: true } });
        if (!member || member.userId) throw new HttpError(409, "The team profile for this invitation is no longer available. Contact your administrator.");
      }

      const claimed = await tx.accountInvitation.updateMany({
        where: { id: current.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new HttpError(409, "This invitation is no longer valid.");

      const createdUser = await tx.user.create({
        data: { email: current.email, passwordHash, role: current.role },
      });

      if (current.teamMemberId) {
        const linked = await tx.teamMember.updateMany({
          where: { id: current.teamMemberId, userId: null },
          data: { userId: createdUser.id },
        });
        if (linked.count !== 1) throw new HttpError(409, "The team profile for this invitation is no longer available. Contact your administrator.");
      } else if (current.name && current.initials && current.memberRole && current.category) {
        await tx.teamMember.create({
          data: {
            userId: createdUser.id,
            name: current.name,
            initials: current.initials,
            role: current.memberRole,
            category: current.category,
          },
        });
      }

      await recordAudit(tx, {
        actor: { id: createdUser.id, email: createdUser.email },
        action: "INVITATION_ACCEPTED",
        entityType: "ACCOUNT_INVITATION",
        entityId: current.id,
        details: { email: createdUser.email, role: createdUser.role },
      });

      return createdUser;
    });

    // Same fixation-safe pattern as POST /api/auth/login: a fresh session id on account creation.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.userId = user.id;

    res.status(201).json({ user: { id: user.id, email: user.email, role: user.role } });
  }),
);

export default router;

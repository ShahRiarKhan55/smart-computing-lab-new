import { Router } from "express";
import bcrypt from "bcryptjs";
import type { UserSummary } from "@scl/shared";
import { canManageUsers, createUserSchema, linkAccountSchema, roleChangeError, updateUserRoleSchema } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { requireCan } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { assertValidId } from "../lib/authorLinks.js";
import { recordAudit } from "../lib/audit.js";
import { assertProfileMayHaveAccount } from "../lib/alumni.js";

const router = Router();

// Accounts and roles are ADMIN-only. A lab manager is deliberately locked out of
// every route in this file (see canManageUsers in @scl/shared).
router.use(requireCan(canManageUsers));

function toUserSummary(row: {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  teamMember: { id: string; name: string } | null;
}): UserSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserSummary["role"],
    createdAt: row.createdAt.toISOString(),
    teamMemberId: row.teamMember?.id ?? null,
    teamMemberName: row.teamMember?.name ?? null,
  };
}

// GET /api/users -> list all accounts
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      include: { teamMember: { select: { id: true, name: true } } },
    });
    res.json(rows.map(toUserSummary));
  }),
);

// POST /api/users -> create a new login for a lab member. Three modes, chosen by
// which fields are present: link an existing unlinked team member (teamMemberId),
// create a new team profile alongside the login (name/initials/memberRole/category),
// or a login with no team profile. All writes happen in one transaction.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(createUserSchema, req.body); // email is already lower-cased
    const passwordHash = await bcrypt.hash(body.password, 10);

    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (existing) throw new HttpError(409, "An account with that email already exists.");

      if (body.teamMemberId) {
        const member = await tx.teamMember.findUnique({ where: { id: body.teamMemberId }, select: { userId: true, category: true } });
        if (!member) throw new HttpError(400, "Selected team member does not exist.");
        assertProfileMayHaveAccount(member);
        if (member.userId) throw new HttpError(409, "That team member already has a linked account.");
      }

      const user = await tx.user.create({ data: { email: body.email, passwordHash, role: body.role } });
      let profileId: string | null = null;
      let profileCreated = false;

      if (body.teamMemberId) {
        // Conditional on "still unlinked" so two concurrent requests can never both claim the same member.
        const linked = await tx.teamMember.updateMany({
          where: { id: body.teamMemberId, userId: null, category: { not: "ALUMNI" } }, // atomic with the category check above
          data: { userId: user.id },
        });
        if (linked.count !== 1) throw new HttpError(409, "That team member already has a linked account.");
        profileId = body.teamMemberId;
      } else if (body.name && body.initials && body.memberRole && body.category) {
        const profile = await tx.teamMember.create({
          data: {
            userId: user.id,
            name: body.name,
            initials: body.initials,
            role: body.memberRole,
            category: body.category,
          },
        });
        profileId = profile.id;
        profileCreated = true;
      }

      await recordAudit(tx, {
        actor: req.user!,
        action: "USER_CREATED",
        entityType: "USER",
        entityId: user.id,
        details: { email: user.email, role: user.role, teamMemberId: profileId, profileCreated },
      });

      return user;
    });

    res.status(201).json({ id: created.id, email: created.email, role: created.role });
  }),
);

// PUT /api/users/:id -> change a user's role
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { role } = parseOrThrow(updateUserRoleSchema, req.body);

    // Nobody changes their own role: it guarantees the acting admin (and so at
    // least one admin) always remains, and rules out self-promotion.
    const denied = roleChangeError(req.user!, req.params.id);
    if (denied) throw new HttpError(req.params.id === req.user!.id ? 400 : 403, denied);

    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, role: true } });
      if (!target) throw new HttpError(404, "Not found");

      await tx.user.update({ where: { id: target.id }, data: { role } });
      if (target.role !== role) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "ROLE_CHANGED",
          entityType: "USER",
          entityId: target.id,
          details: { email: target.email, from: target.role, to: role },
        });
      }
    });

    res.json({ success: true });
  }),
);

// PUT /api/users/:id/link { teamMemberId } -> link this account to an existing, unlinked team profile, or
// (teamMemberId: null) unlink its current profile. ADMIN only (router-level guard). Both directions are
// conditional writes, so two concurrent requests can never claim one profile twice or unlink it twice.
router.put(
  "/:id/link",
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { teamMemberId } = parseOrThrow(linkAccountSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const account = await tx.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, teamMember: { select: { id: true } } } });
      if (!account) throw new HttpError(404, "Not found");

      if (teamMemberId === null) {
        if (!account.teamMember) throw new HttpError(409, "That account isn't linked to a team profile.");
        const unlinked = await tx.teamMember.updateMany({ where: { id: account.teamMember.id, userId: account.id }, data: { userId: null } });
        if (unlinked.count !== 1) throw new HttpError(409, "That account isn't linked to a team profile.");
        await recordAudit(tx, { actor: req.user!, action: "USER_UNLINKED", entityType: "USER", entityId: account.id, details: { email: account.email, teamMemberId: account.teamMember.id } });
        return;
      }

      if (account.teamMember) throw new HttpError(409, "That account is already linked to a team profile. Unlink it first.");
      const member = await tx.teamMember.findUnique({ where: { id: teamMemberId }, select: { id: true, category: true } });
      if (!member) throw new HttpError(400, "Selected team member does not exist.");
      assertProfileMayHaveAccount(member);
      const linked = await tx.teamMember.updateMany({ where: { id: teamMemberId, userId: null, category: { not: "ALUMNI" } }, data: { userId: account.id } }); // atomic with the alumni check above
      if (linked.count !== 1) throw new HttpError(409, "That team member already has a linked account.");
      await recordAudit(tx, { actor: req.user!, action: "USER_LINKED", entityType: "USER", entityId: account.id, details: { email: account.email, teamMemberId } });
    });

    res.json({ success: true });
  }),
);

// DELETE /api/users/:id -> delete an account (not yourself). The linked team
// profile, if any, is kept and simply becomes unlinked.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    if (req.params.id === req.user!.id) {
      throw new HttpError(400, "You can't delete your own account.");
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: req.params.id },
        select: { id: true, email: true, role: true, teamMember: { select: { id: true } } },
      });
      if (!existing) throw new HttpError(404, "Not found");

      await tx.teamMember.updateMany({ where: { userId: existing.id }, data: { userId: null } });
      await tx.user.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "USER_DELETED",
        entityType: "USER",
        entityId: existing.id,
        details: { email: existing.email, role: existing.role, unlinkedTeamMemberId: existing.teamMember?.id ?? null },
      });
    });

    res.json({ success: true });
  }),
);

export default router;

import type { Request, Response, NextFunction } from "express";
import { ID_PATTERN, canEditOtherProfile, canEditProfile, roleSchema, type Actor, type Role } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";

/**
 * Resolves the logged-in user from the session, re-checking the database
 * each time so a role change or account deletion takes effect immediately
 * (mirrors the reference PHP app's current_user()).
 */
export async function getSessionUser(req: Request) {
  const userId = req.session.userId;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) return null;

  // SQLite has no enum type, so `role` is a plain string. An unrecognised value
  // gets the least privilege (MEMBER) rather than being trusted.
  const role: Role = roleSchema.safeParse(user.role).success ? (user.role as Role) : "MEMBER";
  return { id: user.id, email: user.email, role };
}

// Express 4 does not catch rejected promises from async middleware, so every
// guard below goes through asyncHandler: a database failure then reaches the
// error middleware (500) instead of becoming an unhandled rejection.

/**
 * For public routes whose response depends on who is asking (e.g. hiding LAB_ONLY
 * content from guests). Never rejects: a missing, expired or stale session simply
 * leaves `req.user` unset, which every caller must treat as "guest".
 */
export const optionalAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  // The body depends on who is asking (visibility, `isOwn`), so caches must key on the session cookie.
  res.vary("Cookie");
  const user = await getSessionUser(req);
  if (user) req.user = user;
  next();
});

/** 401 for guests. Any logged-in account passes. */
export const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = user;
  next();
});

/**
 * 401 for guests, 403 unless `check(actor)` holds. `check` is one of the policy
 * functions in @scl/shared (e.g. canManageUsers), so the rule lives in one place.
 */
export function requireCan(check: (actor: Actor) => boolean) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!check(user)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    req.user = user;
    next();
  });
}

/**
 * Allows the account linked to the team member referenced by `paramName` (default
 * "id") or any lab manager/admin (canEditProfile), and rejects everyone else.
 *
 * Order matters: 401 for guests first, then 400 for a malformed id, then the
 * ownership check (403 for a member who does not own it — including for an id
 * that does not exist, so a member can't probe which ids are real).
 */
export function requireOwnerOrManager(paramName = "id") {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = user;

    const teamMemberId = req.params[paramName];
    if (!ID_PATTERN.test(teamMemberId)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }

    if (canEditOtherProfile(user)) {
      // A manager needs no ownership; the handler answers 404 for a missing id.
      next();
      return;
    }

    const teamMember = await prisma.teamMember.findUnique({
      where: { id: teamMemberId },
      select: { userId: true },
    });

    if (!teamMember || !canEditProfile(user, teamMember.userId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  });
}

/**
 * Guard for "a lab manager/admin, or a LEAD of this particular project/group".
 * `isLead(resourceId, userId)` looks the membership up; managers skip it.
 * 401 guests -> 400 malformed id -> 403 (also for a missing id, so a member can't
 * probe which ids exist; managers get the handler's 404 instead).
 */
export function requireEditor(
  canEdit: (actor: Actor, isLead: boolean) => boolean,
  isLead: (resourceId: string, userId: string) => Promise<boolean>,
  paramName = "id",
) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = user;

    const resourceId = req.params[paramName];
    if (!ID_PATTERN.test(resourceId)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }

    // canEdit(user, false) is true only for managers: no lookup needed for them.
    const allowed = canEdit(user, false) || canEdit(user, await isLead(resourceId, user.id));
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}

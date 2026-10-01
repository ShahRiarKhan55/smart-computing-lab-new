import { Router } from "express";
import bcrypt from "bcryptjs";
import { loginSchema, changePasswordSchema } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { getSessionUser, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { clearLoginAttempts, isLoginRateLimited, recordFailedLogin } from "../lib/loginRateLimit.js";
import { recordAudit } from "../lib/audit.js";

const router = Router();

// A fixed bcrypt hash with no matching password, computed once at startup. Comparing against it
// for an unknown email costs about the same as comparing against a real user's hash, so response
// timing can't be used to tell "no such account" apart from "wrong password" (Phase 25 §4A).
const DUMMY_HASH = bcrypt.hashSync("no-account-has-this-password", 10);

// GET /api/auth/me -> the current logged-in user, or null
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await getSessionUser(req);
    res.json({ user });
  }),
);

// POST /api/auth/login { email, password }
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = parseOrThrow(loginSchema, req.body);
    const normalizedEmail = email.toLowerCase();
    const ip = req.ip ?? "unknown";

    // Brute-force guard: a client that has failed too many times against this (ip, email) pair
    // recently is refused before touching the database or comparing a password (Phase 25 §4A).
    if (isLoginRateLimited(ip, normalizedEmail)) {
      throw new HttpError(429, "Too many login attempts. Please wait a few minutes and try again.");
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    // Always run bcrypt.compare — against the real hash if the account exists, else a fixed dummy
    // one — so an unknown email and a wrong password take about the same time and cannot be told
    // apart by response timing (see DUMMY_HASH above).
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) {
      recordFailedLogin(ip, normalizedEmail);
      throw new HttpError(401, "Incorrect email or password.");
    }
    clearLoginAttempts(ip, normalizedEmail);

    // Regenerate the session id on login to prevent session fixation.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.userId = user.id;

    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  }),
);

// POST /api/auth/password { currentPassword, newPassword } -> self-service password change for
// the logged-in account only (there is no "change someone else's password" route anywhere —
// account recovery for a locked-out user is an admin deleting + re-inviting them, same as today).
// Requires the correct CURRENT password, so a hijacked-but-still-logged-in session cannot be used
// to lock the real owner out permanently without first proving it already knows the password.
router.post(
  "/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parseOrThrow(changePasswordSchema, req.body);
    const ip = req.ip ?? "unknown";

    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, email: true, passwordHash: true } });
    if (!user) throw new HttpError(401, "Unauthorized");

    // Same brute-force guard as login (keyed the same way), since this is the same kind of
    // bcrypt.compare an attacker could otherwise hammer from a stolen-but-still-valid session.
    if (isLoginRateLimited(ip, user.email)) {
      throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
    }

    const currentOk = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentOk) {
      recordFailedLogin(ip, user.email);
      throw new HttpError(401, "Current password is incorrect.");
    }
    clearLoginAttempts(ip, user.email);

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
      await recordAudit(tx, { actor: { id: user.id, email: user.email }, action: "PASSWORD_CHANGED", entityType: "USER", entityId: user.id });
    });

    // Fresh session id after a password change, same fixation-safe pattern as login — the old
    // session id (and so any copy of it an attacker may hold) stops working immediately, while the
    // user making the change stays logged in under the new id.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.userId = user.id;

    res.json({ success: true });
  }),
);

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("scl.sid");
    res.json({ success: true });
  });
});

export default router;

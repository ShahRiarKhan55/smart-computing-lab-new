import { Router } from "express";
import bcrypt from "bcryptjs";
import { loginSchema } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { getSessionUser } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";

const router = Router();

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

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, "Incorrect email or password.");
    }

    // Regenerate the session id on login to prevent session fixation.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.userId = user.id;

    res.json({ user: { id: user.id, email: user.email, role: user.role } });
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

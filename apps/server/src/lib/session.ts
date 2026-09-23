import session from "express-session";
import { prisma } from "./prisma.js";
import { PrismaSessionStore } from "./prismaSessionStore.js";

const ONE_WEEK_MS = 1000 * 60 * 60 * 24 * 7;

export function createSessionMiddleware() {
  return session({
    store: new PrismaSessionStore(prisma),
    name: "scl.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ONE_WEEK_MS,
    },
  });
}

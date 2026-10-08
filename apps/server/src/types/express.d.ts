import "express-session";
import type { Role } from "@scl/shared";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    /** In-flight Google sign-in (Phase 27): the one-time values this browser must present on the callback. */
    googleOAuth?: { state: string; nonce: string; verifier: string; link: boolean; createdAt: number };
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: Role;
      };
    }
  }
}

export {};

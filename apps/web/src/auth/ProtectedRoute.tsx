import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Actor } from "@scl/shared";
import { useAuth } from "./AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
  /** A policy function from @scl/shared (e.g. canManageUsers); the visitor is redirected home if it fails. */
  allow?: (actor: Actor) => boolean;
}

/**
 * Client-side route gating for UX only (hiding pages behind a redirect).
 * The Express API independently re-checks auth/role on every request —
 * this component is not the security boundary.
 */
export function ProtectedRoute({ children, allow }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="container">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // The web tsconfig is not strict, so Zod infers every SessionUser field as optional; a session user always has both.
  if (allow && !allow(user as Actor)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

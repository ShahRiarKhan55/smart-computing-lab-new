import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { TranslationKey } from "@scl/shared";
import { isSafeRedirectPath } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { ErrorState } from "../components/ErrorState";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useApiResource } from "../hooks/useApiResource";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";

/** The only `?error=` values the Google callback ever sends; anything else is ignored (never echoed). */
const GOOGLE_ERROR_KEY: Record<string, TranslationKey> = {
  google_failed: "auth.google.failed",
  google_denied: "auth.google.denied",
  google_unconfigured: "auth.google.unconfigured",
};

export function LoginPage() {
  const t = useT();
  useDocumentTitle(t("title.login"));
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Offered only when the server says Google sign-in is configured; while loading / on error nothing changes.
  const google = useApiResource<{ enabled: boolean }>("/auth/google/config");
  const googleErrorKey = GOOGLE_ERROR_KEY[new URLSearchParams(location.search).get("error") ?? ""];

  const requestedFrom = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  // Phase 25 open-redirect guard: `requestedFrom` traces back to ProtectedRoute's `location.pathname`,
  // which an attacker can influence via a crafted link (e.g. "/\evil.example.com", which some browsers
  // treat as protocol-relative — the shape behind react-router's own open-redirect advisories in
  // `<Link>`/`useNavigate`). Only a genuine same-app path is ever passed to `navigate()` after login;
  // anything else falls back to the ordinary default, exactly as if no redirect had been requested.
  const from = isSafeRedirectPath(requestedFrom) ? requestedFrom : "/profile";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container container--narrow">
      <div className="auth-card">
        <span className="auth-card__mark" aria-hidden="true">
          SCL<span>_</span>
        </span>
        <h1>{t("auth.title")}</h1>
        <p className="sub">{t("auth.subtitle")}</p>

        {error && <ErrorState message={error} />}
        {googleErrorKey && <ErrorState message={t(googleErrorKey)} />}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">{t("auth.email")}</label>
            <input id="email" type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="password">{t("auth.password")}</label>
            <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn btn--primary btn--lg btn--block form-submit" type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? t("auth.loggingIn") : t("auth.login")}
          </button>
        </form>

        {google.data?.enabled && (
          <div className="auth-card__alt">
            <p className="auth-card__or" aria-hidden="true">
              {t("auth.google.or")}
            </p>
            {/* A plain link (full-page navigation): the server starts the OpenID Connect flow and Google redirects back to it. */}
            <a className="btn btn--secondary btn--lg btn--block" href="/api/auth/google/start">
              {t("auth.google.signIn")}
            </a>
          </div>
        )}

        <p className="auth-card__foot">
          {t("auth.noAccount")}{" "}
          <Link to="/contact" className="link">
            {t("auth.contactAdmin")}
          </Link>{" "}
          {t("auth.contactAdminSuffix")}
        </p>
        <p className="auth-card__foot">
          <Link to="/docs/onboarding" className="link">
            {t("docs.onboardingGuideLink")}
          </Link>
        </p>
      </div>
    </div>
  );
}

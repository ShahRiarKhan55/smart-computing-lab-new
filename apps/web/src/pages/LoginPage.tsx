import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorState } from "../components/ErrorState";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";

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

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/profile";

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

        <p className="auth-card__foot">
          {t("auth.noAccount")}{" "}
          <Link to="/contact" className="link">
            {t("auth.contactAdmin")}
          </Link>{" "}
          {t("auth.contactAdminSuffix")}
        </p>
      </div>
    </div>
  );
}

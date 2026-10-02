import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { acceptInvitationSchema, type InvitationInfo } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";
import { apiFetch, ApiError } from "../lib/api";

type LoadState = { kind: "loading" } | { kind: "invalid" } | { kind: "ready"; email: string };

/**
 * Researcher onboarding (PHASE 1): the ONLY page that ever asks a researcher to choose a
 * password — the admin who created the invitation never sees or sets it (see
 * apps/server/src/routes/invitations.routes.ts). Reached at /invite/:token; the token itself is
 * the credential that authorizes this page (no login required to view or submit it), exactly like
 * clicking a password-reset link from any other application, except this account does not exist
 * yet until this form is submitted.
 */
export function InvitePage() {
  const t = useT();
  useDocumentTitle(t("invite.title"));
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await apiFetch<InvitationInfo>(`/invitations/token/${token}`);
        if (cancelled) return;
        setState(info.valid && info.email ? { kind: "ready", email: info.email } : { kind: "invalid" });
      } catch {
        if (!cancelled) setState({ kind: "invalid" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccepted() {
    await refresh();
    navigate("/profile", { replace: true });
  }

  return (
    <div className="container container--narrow">
      <div className="auth-card">
        <span className="auth-card__mark" aria-hidden="true">
          SCL<span>_</span>
        </span>
        <h1>{t("invite.heading")}</h1>

        {state.kind === "loading" && <LoadingState label={t("invite.checking")} variant="text" />}
        {state.kind === "invalid" && (
          <>
            <ErrorState message={t("invite.invalidOrExpired")} />
            <p className="sub">{t("invite.invalidHint")}</p>
          </>
        )}
        {state.kind === "ready" && <AcceptForm token={token ?? ""} email={state.email} onAccepted={handleAccepted} />}
      </div>
    </div>
  );
}

function AcceptForm({ token, email, onAccepted }: { token: string; email: string; onAccepted: () => Promise<void> }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError(t("invite.passwordsDontMatch"));
      return;
    }
    const parsed = acceptInvitationSchema.safeParse({ password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/invitations/token/${token}/accept`, { method: "POST", body: JSON.stringify({ password }) });
      await onAccepted();
    } catch (err) {
      setError(err instanceof ApiError ? apiErrorMessage(err, t) : t("error.network"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <p className="sub">{t("invite.subtitle", { email })}</p>
      {error && <ErrorState message={error} />}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="invite_password">{t("invite.newPassword")}</label>
          <input
            id="invite_password"
            type="password"
            required
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="form-hint">{t("invite.passwordHint")}</p>
        </div>
        <div className="form-group">
          <label htmlFor="invite_confirm">{t("invite.confirmPassword")}</label>
          <input
            id="invite_confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button className="btn btn--primary btn--lg btn--block form-submit" type="submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? t("invite.activating") : t("invite.activateAccount")}
        </button>
      </form>
      <p className="auth-card__foot">{t("invite.neverShareNote")}</p>
    </>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import type { CandidateStatus, PublicationCandidate, PublicationImportList, PublicationSyncResult, TeamMember, Visibility } from "@scl/shared";
import { useApiResource } from "../hooks/useApiResource";
import { useSeo } from "../hooks/useSeo";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { VisibilityField } from "../components/VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";

const TABS: CandidateStatus[] = ["PENDING", "APPROVED", "REJECTED", "DUPLICATE"];

/**
 * Editorial review of publications discovered from researchers' public ORCID records. Managers/admins only
 * (the API re-checks every call). Nothing shown here is public: approving creates the real publication.
 */
export function PublicationImportsPage() {
  const t = useT();
  const [status, setStatus] = useState<CandidateStatus>("PENDING");
  const { data, loading, error, reload } = useApiResource<PublicationImportList>(`/publication-imports?status=${status}`);
  const { data: team } = useApiResource<TeamMember[]>("/team");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useSeo({ title: t("pubimport.pageTitle"), description: t("pubimport.pageDescription") });

  async function runSync() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await apiFetch<PublicationSyncResult>("/publication-imports/sync", { method: "POST", body: "{}" });
      const s = r.summary;
      setNotice({
        kind: s && s.failed.length > 0 ? "error" : "ok",
        text: s ? `${t("pubimport.syncDone", { created: s.created, duplicates: s.duplicates, failed: s.failed.length })}${s.failed.length > 0 ? ` ${t("pubimport.syncFailedSome")}` : ""}` : "",
      });
      reload();
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof ApiError && err.status === 409 ? t("pubimport.syncRunning") : apiErrorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const lastRun = data?.sync.lastRunAt ? new Date(data.sync.lastRunAt).toLocaleString() : null;

  return (
    <>
      <PageHeader eyebrow={t("pubimport.eyebrow")} title={t("pubimport.pageTitle")} description={t("pubimport.pageDescription")} />
      <div className="container">
        <p>
          <Link to="/publications">← {t("pubimport.back")}</Link>
        </p>

        <div className="admin-bar">
          <span className="admin-bar__text">
            {data && data.sync.orcidResearchers === 0 ? t("pubimport.noOrcid") : data ? t("pubimport.researchers", { n: data.sync.orcidResearchers }) : ""}{" "}
            {lastRun ? t("pubimport.lastRun", { when: lastRun, status: data!.sync.lastStatus }) : data ? t("pubimport.neverRun") : ""}
          </span>
          <div className="admin-bar__actions">
            <button className="btn btn--primary btn--sm" type="button" onClick={runSync} disabled={busy || (data?.sync.orcidResearchers ?? 0) === 0}>
              {busy ? t("pubimport.syncing") : t("pubimport.syncNow")}
            </button>
          </div>
        </div>
        <p className="form-hint">{t("pubimport.scopeNote")}</p>
        {notice && (
          <div className={notice.kind === "error" ? "form-error" : "form-success"} role={notice.kind === "error" ? "alert" : "status"}>
            {notice.text}
          </div>
        )}

        <div role="tablist" aria-label={t("pubimport.pageTitle")} className="tab-row">
          {TABS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={status === s} className={`btn btn--sm ${status === s ? "btn--primary" : "btn--secondary"}`} onClick={() => setStatus(s)}>
              {t(`pubimport.tab.${s}` as never)}
            </button>
          ))}
        </div>

        {loading && !data && <LoadingState label={t("pubimport.loading")} />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {data && data.items.length === 0 && <EmptyState title={status === "PENDING" ? t("pubimport.empty") : t("pubimport.emptyOther")} />}
        {data && (
          <ul className="candidate-list">
            {data.items.map((c) => (
              <CandidateCard key={c.id} candidate={c} team={team ?? []} onDone={(text) => { setNotice({ kind: "ok", text }); reload(); }} onError={(text) => setNotice({ kind: "error", text })} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function CandidateCard({ candidate: c, team, onDone, onError }: { candidate: PublicationCandidate; team: TeamMember[]; onDone: (text: string) => void; onError: (text: string) => void }) {
  const t = useT();
  const [authors, setAuthors] = useState(c.authors);
  const [venue, setVenue] = useState(c.venue);
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [busy, setBusy] = useState(false);
  const names = c.researcherIds.map((id) => team.find((m) => m.id === id)?.name).filter(Boolean).join(", ");
  const pending = c.status === "PENDING";

  async function act(kind: "approve" | "reject") {
    if (kind === "reject" && !window.confirm(t("pubimport.rejectConfirm"))) return;
    setBusy(true);
    try {
      await apiFetch(`/publication-imports/${c.id}/${kind}`, {
        method: "POST",
        body: JSON.stringify(kind === "approve" ? { authors: authors.trim() || undefined, venue: venue.trim() || undefined, visibility } : {}),
      });
      onDone(kind === "approve" ? t("pubimport.approved") : t("pubimport.rejected"));
    } catch (err) {
      onError(apiErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="candidate-card card">
      <h3>{c.title}</h3>
      <p>
        {c.year}
        {c.venue ? ` · ${c.venue}` : ""}
        {c.doi ? (
          <>
            {" · "}
            <a href={c.url} target="_blank" rel="noopener noreferrer">
              DOI: {c.doi}
            </a>
          </>
        ) : c.url ? (
          <>
            {" · "}
            <a href={c.url} target="_blank" rel="noopener noreferrer">
              {t("pubimport.source")}
            </a>
          </>
        ) : null}
      </p>
      {names && <p className="form-hint">{names}</p>}
      <p className="form-hint">{t("pubimport.source")}</p>
      {c.possibleDuplicateId && (
        <p className="form-hint" role="note">
          {t("pubimport.possibleDuplicate")} <Link to={`/publications/${c.possibleDuplicateId}`}>{t("pubimport.viewExisting")}</Link>
        </p>
      )}
      {c.status === "DUPLICATE" && c.publicationId && <Link to={`/publications/${c.publicationId}`}>{t("pubimport.viewExisting")}</Link>}
      {c.status === "APPROVED" && c.publicationId && <Link to={`/publications/${c.publicationId}`}>{t("pubimport.viewExisting")}</Link>}
      {pending && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={`cand_authors_${c.id}`}>{t("pubimport.authorsLabel")}</label>
              <input id={`cand_authors_${c.id}`} value={authors} onChange={(e) => setAuthors(e.target.value)} maxLength={1000} />
            </div>
            <div className="form-group">
              <label htmlFor={`cand_venue_${c.id}`}>{t("pubimport.venueLabel")}</label>
              <input id={`cand_venue_${c.id}`} value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={500} />
            </div>
          </div>
          <VisibilityField id={`cand_vis_${c.id}`} value={visibility} onChange={setVisibility} />
          <div className="modal__actions">
            <button className="btn btn--primary btn--sm" type="button" onClick={() => act("approve")} disabled={busy}>
              {t("pubimport.approve")}
            </button>
            <button className="btn btn--secondary btn--sm" type="button" onClick={() => act("reject")} disabled={busy}>
              {t("pubimport.reject")}
            </button>
          </div>
        </>
      )}
    </li>
  );
}

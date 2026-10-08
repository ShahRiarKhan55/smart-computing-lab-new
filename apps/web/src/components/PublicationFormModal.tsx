import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPublicationSchema, doiFromUrl, normalizeDoi, type DoiLookupResult, type Publication, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { apiErrorMessage, knownMessage } from "../i18n/errorMessages";
import { useEntityTranslations } from "../hooks/useEntityTranslations";
import { useT } from "../i18n/LocaleContext";
import { apiFetch, ApiError } from "../lib/api";

/** What the form hands to the page: the validated, trimmed publication fields. */
export interface PublicationFormFields {
  year: number;
  title: string;
  authors: string;
  venue: string;
  pdfUrl: string;
  doiUrl: string;
  extraUrl: string;
  extraLabel: string;
  visibility?: Visibility;
  /** Japanese title/venue overrides (Phase 19). An empty box on an existing publication clears that override. */
  translations?: { ja: Record<string, string> };
}

interface FormState {
  year: string;
  title: string;
  authors: string;
  venue: string;
  pdfUrl: string;
  doiUrl: string;
  extraUrl: string;
  extraLabel: string;
}

interface PublicationFormModalProps {
  open: boolean;
  title: string;
  /** Existing publication when editing; omit/null to create a new one. */
  initial?: Publication | null;
  /** Offer "link this to my profile" on create (only when the user has a team profile). */
  canLinkSelf: boolean;
  /** Lab managers/admins only; the API rejects anyone else who sends it. */
  canSetVisibility?: boolean;
  onClose: () => void;
  onSubmit: (fields: PublicationFormFields, linkSelf: boolean) => Promise<void>;
}

function toFormState(initial?: Publication | null): FormState {
  return {
    year: initial ? String(initial.year) : String(new Date().getFullYear()),
    title: initial?.title ?? "",
    authors: initial?.authors ?? "",
    venue: initial?.venue ?? "",
    pdfUrl: initial?.pdfUrl ?? "",
    // Shown as the bare DOI the person would type; the server stores the canonical doi.org link.
    doiUrl: initial?.doiUrl ? (doiFromUrl(initial.doiUrl) ?? initial.doiUrl) : "",
    extraUrl: initial?.extraUrl ?? "",
    extraLabel: initial?.extraLabel ?? "",
  };
}

export function PublicationFormModal({
  open,
  title,
  initial,
  canLinkSelf,
  canSetVisibility = false,
  onClose,
  onSubmit,
}: PublicationFormModalProps) {
  const t = useT();
  const [values, setValues] = useState<FormState>(() => toFormState(initial));
  const [linkSelf, setLinkSelf] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? "PUBLIC");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lookup, setLookup] = useState<{ busy: boolean; message: string | null; failed: boolean }>({ busy: false, message: null, failed: false });
  const { values: ja, setField: setJa, base } = useEntityTranslations("PUBLICATION", initial?.id, open);

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial));
      setLinkSelf(false);
      setVisibility(initial?.visibility ?? "PUBLIC");
      setError(null);
      setLookup({ busy: false, message: null, failed: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // A page fetched in Japanese already carries the Japanese override in title/venue; saving that back would
  // overwrite the English text. Once the publication's own English text arrives, it replaces the prefill.
  useEffect(() => {
    if (!open || !base) return;
    setValues((v) => ({ ...v, ...(base.title != null ? { title: base.title } : {}), ...(base.venue != null ? { venue: base.venue } : {}) }));
  }, [open, base]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // "Fill from DOI": suggestions only, never saved; the person reviews and edits before pressing Save. Manual entry is unchanged.
  async function fillFromDoi() {
    const doi = normalizeDoi(values.doiUrl);
    if (!doi) {
      setLookup({ busy: false, message: t("publications.fillFromDoiNeedDoi"), failed: true });
      return;
    }
    setLookup({ busy: true, message: null, failed: false });
    try {
      const r = await apiFetch<DoiLookupResult>(`/publication-imports/lookup?doi=${encodeURIComponent(doi)}`);
      setValues((v) => ({
        ...v,
        doiUrl: r.doi,
        title: r.title || v.title,
        authors: r.authors || v.authors,
        venue: r.venue || v.venue,
        year: r.year ? String(r.year) : v.year,
      }));
      setLookup({ busy: false, message: t("publications.fillFromDoiDone"), failed: false });
    } catch (err) {
      setLookup({ busy: false, message: err instanceof ApiError && err.status === 429 ? t("publications.fillFromDoiLimit") : t("publications.fillFromDoiFailed"), failed: true });
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validation = createPublicationSchema.safeParse(values);
    if (!validation.success) {
      const first = validation.error.issues[0]?.message;
      setError(first ? knownMessage(first, t) : t("common.checkForm"));
      return;
    }
    const { teamMemberIds: _unused, translations: _tr, ...fields } = validation.data;
    // An existing publication sends every box (an empty one clears its override); a new one only what was typed.
    const jaPayload = initial ? ja : Object.fromEntries(Object.entries(ja).filter(([, v]) => v.trim() !== ""));
    const withTranslations = Object.keys(jaPayload).length > 0 ? { ...fields, translations: { ja: jaPayload } } : fields;

    setSubmitting(true);
    try {
      await onSubmit((canSetVisibility ? { ...withTranslations, visibility } : withTranslations) as PublicationFormFields, linkSelf);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit} noValidate>
        <fieldset className="form-fieldset">
          <legend>{t("publications.form.groupDetails")}</legend>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="pub_year">{t("common.yearLabel")}</label>
            <input
              id="pub_year"
              type="number"
              inputMode="numeric"
              value={values.year}
              onChange={(e) => set("year", e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="pub_venue">{t("publications.venueLabel")}</label>
            <input id="pub_venue" value={values.venue} onChange={(e) => set("venue", e.target.value)} required />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="pub_title">{t("common.titleLabel")}</label>
          <textarea id="pub_title" value={values.title} onChange={(e) => set("title", e.target.value)} required />
        </div>

        <div className="form-group">
          <label htmlFor="pub_authors">{t("publications.authorsLabel")}</label>
          <input
            id="pub_authors"
            value={values.authors}
            onChange={(e) => set("authors", e.target.value)}
            placeholder={t("publications.authorsPlaceholder")}
            required
          />
        </div>
        </fieldset>

        <fieldset className="form-fieldset">
          <legend>{t("publications.form.groupLinks")}</legend>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="pub_pdfUrl">{t("publications.pdfUrlLabel")}</label>
            <input
              id="pub_pdfUrl"
              value={values.pdfUrl}
              onChange={(e) => set("pdfUrl", e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="form-group">
            <label htmlFor="pub_doiUrl">{t("publications.doiUrlLabel")}</label>
            <input
              id="pub_doiUrl"
              value={values.doiUrl}
              onChange={(e) => set("doiUrl", e.target.value)}
              placeholder={t("publications.doiPlaceholder")}
              aria-describedby="pub_doiUrl_hint"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="form-hint" id="pub_doiUrl_hint">
              {t("publications.doiHint")}
            </p>
            <button className="btn btn--secondary btn--sm" type="button" onClick={fillFromDoi} disabled={lookup.busy || submitting}>
              {lookup.busy ? t("publications.fillFromDoiBusy") : t("publications.fillFromDoi")}
            </button>
            {lookup.message && (
              <p className={lookup.failed ? "form-hint form-hint--error" : "form-hint"} role="status">
                {lookup.message}
              </p>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="pub_extraUrl">{t("publications.extraUrlLabel")}</label>
            <input
              id="pub_extraUrl"
              value={values.extraUrl}
              onChange={(e) => set("extraUrl", e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="form-group">
            <label htmlFor="pub_extraLabel">{t("publications.extraLabelLabel")}</label>
            <input
              id="pub_extraLabel"
              value={values.extraLabel}
              onChange={(e) => set("extraLabel", e.target.value)}
              placeholder={t("publications.extraLabelPlaceholder")}
            />
          </div>
        </div>

        </fieldset>

        {/* Phase 19: Japanese title/venue, next to the English ones, in the same form (the Phase 14 pattern). */}
        <fieldset className="form-fieldset">
          <legend>{t("lang.ja.name")}</legend>
          <div className="form-group">
            <label htmlFor="pub_title_ja">
              {t("common.optional")}: {t("publications.form.titleJaLabel")}
            </label>
            <textarea id="pub_title_ja" lang="ja" value={ja.title ?? ""} onChange={(e) => setJa("title", e.target.value)} maxLength={500} />
          </div>
          <div className="form-group">
            <label htmlFor="pub_venue_ja">
              {t("common.optional")}: {t("publications.form.venueJaLabel")}
            </label>
            <input id="pub_venue_ja" lang="ja" value={ja.venue ?? ""} onChange={(e) => setJa("venue", e.target.value)} maxLength={500} />
          </div>
        </fieldset>

        {canSetVisibility && <VisibilityField id="pub_visibility" value={visibility} onChange={setVisibility} />}

        {!initial && canLinkSelf && (
          <label className="check-row">
            <input type="checkbox" checked={linkSelf} onChange={(e) => setLinkSelf(e.target.checked)} />
            <span>{t("publications.linkSelfCheckbox")}</span>
          </label>
        )}

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

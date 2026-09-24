import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPublicationSchema, type Publication, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { ApiError } from "../lib/api";
import { useT } from "../i18n/LocaleContext";

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
    doiUrl: initial?.doiUrl ?? "",
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

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial));
      setLinkSelf(false);
      setVisibility(initial?.visibility ?? "PUBLIC");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validation = createPublicationSchema.safeParse(values);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }
    const { teamMemberIds: _unused, ...fields } = validation.data;

    setSubmitting(true);
    try {
      await onSubmit((canSetVisibility ? { ...fields, visibility } : fields) as PublicationFormFields, linkSelf);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit} noValidate>
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
              placeholder="https://doi.org/..."
            />
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

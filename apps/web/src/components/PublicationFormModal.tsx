import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPublicationSchema, type Publication, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { ApiError } from "../lib/api";

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
      setError(validation.error.issues[0]?.message ?? "Please check the form.");
      return;
    }
    const { teamMemberIds: _unused, ...fields } = validation.data;

    setSubmitting(true);
    try {
      await onSubmit((canSetVisibility ? { ...fields, visibility } : fields) as PublicationFormFields, linkSelf);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
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
            <label htmlFor="pub_year">Year</label>
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
            <label htmlFor="pub_venue">Venue (journal / conference)</label>
            <input id="pub_venue" value={values.venue} onChange={(e) => set("venue", e.target.value)} required />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="pub_title">Title</label>
          <textarea id="pub_title" value={values.title} onChange={(e) => set("title", e.target.value)} required />
        </div>

        <div className="form-group">
          <label htmlFor="pub_authors">Authors (comma-separated, as printed on the paper)</label>
          <input
            id="pub_authors"
            value={values.authors}
            onChange={(e) => set("authors", e.target.value)}
            placeholder="e.g. Jane Doe, John Smith"
            required
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="pub_pdfUrl">PDF URL (optional)</label>
            <input
              id="pub_pdfUrl"
              value={values.pdfUrl}
              onChange={(e) => set("pdfUrl", e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="form-group">
            <label htmlFor="pub_doiUrl">DOI URL (optional)</label>
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
            <label htmlFor="pub_extraUrl">Extra link URL (optional)</label>
            <input
              id="pub_extraUrl"
              value={values.extraUrl}
              onChange={(e) => set("extraUrl", e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="form-group">
            <label htmlFor="pub_extraLabel">Extra link label</label>
            <input
              id="pub_extraLabel"
              value={values.extraLabel}
              onChange={(e) => set("extraLabel", e.target.value)}
              placeholder="e.g. Code"
            />
          </div>
        </div>

        {canSetVisibility && <VisibilityField id="pub_visibility" value={visibility} onChange={setVisibility} />}

        {!initial && canLinkSelf && (
          <label className="check-row">
            <input type="checkbox" checked={linkSelf} onChange={(e) => setLinkSelf(e.target.checked)} />
            <span>Also show this publication on my member profile</span>
          </label>
        )}

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

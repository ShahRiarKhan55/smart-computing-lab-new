import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { PUBLICATION_STATUSES, createPublicationSchema, type Publication, type TranslationKey, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { apiErrorMessage } from "../i18n/errorMessages";
import { useEntityTranslations } from "../hooks/useEntityTranslations";
import { useT } from "../i18n/LocaleContext";
import { DuplicateConfirm } from "./DuplicateConfirm";
import { useDuplicateConfirm } from "../hooks/useDuplicateConfirm";
import { numberToField } from "../lib/publicationMeta";

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
  /** Optional metadata; "" / 0 mean "not stated". */
  status: string;
  listNumber: string;
  category: string;
  volume: string;
  startPage: number;
  endPage: number;
  month: number;
  acceptedDate: string;
  visibility?: Visibility;
  /** Japanese title/venue overrides (Phase 19). An empty box on an existing publication clears that override. */
  translations?: { ja: Record<string, string> };
  /** Set only after a duplicate warning was explicitly confirmed (lab manager / admin). */
  confirmDuplicate?: boolean;
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
  status: string;
  listNumber: string;
  category: string;
  volume: string;
  startPage: string;
  endPage: string;
  month: string;
  acceptedDate: string;
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
    status: initial?.status ?? "",
    listNumber: initial?.listNumber ?? "",
    category: initial?.category ?? "",
    volume: initial?.volume ?? "",
    startPage: numberToField(initial?.startPage ?? 0),
    endPage: numberToField(initial?.endPage ?? 0),
    month: numberToField(initial?.month ?? 0),
    acceptedDate: initial?.acceptedDate ?? "",
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
  const dup = useDuplicateConfirm();
  const { values: ja, setField: setJa, base } = useEntityTranslations("PUBLICATION", initial?.id, open);

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial));
      setLinkSelf(false);
      setVisibility(initial?.visibility ?? "PUBLIC");
      setError(null);
      dup.reset();
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
    dup.reset(); // a changed field invalidates any earlier duplicate warning and its confirmation
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validation = createPublicationSchema.safeParse(values);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }
    const { teamMemberIds: _unused, translations: _tr, ...fields } = validation.data;
    // An existing publication sends every box (an empty one clears its override); a new one only what was typed.
    const jaPayload = initial ? ja : Object.fromEntries(Object.entries(ja).filter(([, v]) => v.trim() !== ""));
    const withTranslations = Object.keys(jaPayload).length > 0 ? { ...fields, translations: { ja: jaPayload } } : fields;

    setSubmitting(true);
    try {
      await onSubmit({ ...(canSetVisibility ? { ...withTranslations, visibility } : withTranslations), ...dup.extra } as PublicationFormFields, linkSelf);
      onClose();
    } catch (err) {
      dup.capture(err);
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <DuplicateConfirm conflict={dup.conflict} confirmed={dup.confirmed} onConfirmedChange={dup.setConfirmed} />
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

        </fieldset>

        {/* Optional metadata from the lab's publication-list workbook; every box may stay blank. */}
        <fieldset className="form-fieldset">
          <legend>{t("publications.form.groupMetadata")}</legend>
          <p className="text-sm text-muted">{t("publications.form.metadataHint")}</p>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="pub_status">{t("publications.meta.status")}</label>
              <select id="pub_status" value={values.status} onChange={(e) => set("status", e.target.value)}>
                <option value="">{t("publications.meta.statusNone")}</option>
                {PUBLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`publications.meta.status.${s}` as TranslationKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pub_category">{t("publications.meta.category")}</label>
              <input id="pub_category" value={values.category} maxLength={100} onChange={(e) => set("category", e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="pub_listNumber">{t("publications.meta.listNumber")}</label>
              <input id="pub_listNumber" value={values.listNumber} maxLength={100} onChange={(e) => set("listNumber", e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="pub_volume">{t("publications.meta.volume")}</label>
              <input id="pub_volume" value={values.volume} maxLength={100} onChange={(e) => set("volume", e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="pub_startPage">{t("publications.meta.startPage")}</label>
              <input id="pub_startPage" type="number" inputMode="numeric" min={1} value={values.startPage} onChange={(e) => set("startPage", e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="pub_endPage">{t("publications.meta.endPage")}</label>
              <input id="pub_endPage" type="number" inputMode="numeric" min={1} value={values.endPage} onChange={(e) => set("endPage", e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="pub_month">{t("publications.meta.month")}</label>
              <input
                id="pub_month"
                type="number"
                inputMode="numeric"
                min={1}
                max={12}
                value={values.month}
                placeholder={t("publications.meta.monthPlaceholder")}
                onChange={(e) => set("month", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="pub_acceptedDate">{t("publications.meta.acceptedDate")}</label>
              <input id="pub_acceptedDate" type="date" value={values.acceptedDate} onChange={(e) => set("acceptedDate", e.target.value)} />
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

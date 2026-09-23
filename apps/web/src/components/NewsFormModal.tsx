import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createNewsItemSchema, NEWS_TYPES, type NewsItem, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";

/** What the form hands to the page: the validated, trimmed news fields. */
export interface NewsFormFields {
  date: string;
  sortDate: string;
  type: string;
  emoji: string;
  title: string;
  description: string;
  visibility?: Visibility;
}

interface NewsFormModalProps {
  open: boolean;
  title: string;
  /** Existing item when editing; omit/null to create a new one. */
  initial?: NewsItem | null;
  /** Offer "link this to my profile" on create (only when the user has a team profile). */
  canLinkSelf: boolean;
  /** Lab managers/admins only; the API rejects anyone else who sends it. */
  canSetVisibility?: boolean;
  onClose: () => void;
  onSubmit: (fields: NewsFormFields, linkSelf: boolean) => Promise<void>;
}

function toFormState(initial?: NewsItem | null): NewsFormFields {
  return {
    date: initial?.date ?? "",
    sortDate: initial?.sortDate ?? new Date().toISOString().slice(0, 10),
    type: initial?.type ?? "Event",
    emoji: initial?.emoji ?? "📣",
    title: initial?.title ?? "",
    description: initial?.description ?? "",
  };
}

export function NewsFormModal({ open, title, initial, canLinkSelf, canSetVisibility = false, onClose, onSubmit }: NewsFormModalProps) {
  const t = useT();
  const [values, setValues] = useState<NewsFormFields>(() => toFormState(initial));
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

  function set<K extends keyof NewsFormFields>(key: K, value: NewsFormFields[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validation = createNewsItemSchema.safeParse(values);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }
    const { teamMemberIds: _unused, ...fields } = validation.data;

    setSubmitting(true);
    try {
      await onSubmit((canSetVisibility ? { ...fields, visibility } : fields) as NewsFormFields, linkSelf);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  // Keep an existing item's type selectable even if it is not one of the standard options.
  const typeOptions: string[] = NEWS_TYPES.includes(values.type as (typeof NEWS_TYPES)[number])
    ? [...NEWS_TYPES]
    : [...NEWS_TYPES, values.type];

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="news_date">Display date</label>
            <input
              id="news_date"
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
              placeholder="e.g. May 2025"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="news_sortDate">Sort date (controls ordering)</label>
            <input
              id="news_sortDate"
              type="date"
              value={values.sortDate}
              onChange={(e) => set("sortDate", e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="news_type">Type</label>
            <select id="news_type" value={values.type} onChange={(e) => set("type", e.target.value)}>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="news_emoji">Emoji</label>
            <input id="news_emoji" value={values.emoji} onChange={(e) => set("emoji", e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="news_title">Title</label>
          <input id="news_title" value={values.title} onChange={(e) => set("title", e.target.value)} required />
        </div>

        <div className="form-group">
          <label htmlFor="news_description">Description</label>
          <textarea
            id="news_description"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            required
          />
        </div>

        {canSetVisibility && <VisibilityField id="news_visibility" value={visibility} onChange={setVisibility} />}

        {!initial && canLinkSelf && (
          <label className="check-row">
            <input type="checkbox" checked={linkSelf} onChange={(e) => setLinkSelf(e.target.checked)} />
            <span>Also show this news item on my member profile</span>
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

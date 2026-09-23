import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createNewsItemSchema, NEWS_TYPES, type NewsItem, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";
import { useEntityTranslations } from "../hooks/useEntityTranslations";

/** What the form hands to the page: the validated, trimmed news fields. */
export interface NewsFormFields {
  date: string;
  sortDate: string;
  type: string;
  emoji: string;
  title: string;
  description: string;
  visibility?: Visibility;
  translations?: { ja: Record<string, string> };
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

function toFormState(initial?: NewsItem | null): Omit<NewsFormFields, "translations"> {
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
  const [values, setValues] = useState(() => toFormState(initial));
  const [linkSelf, setLinkSelf] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? "PUBLIC");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { values: ja, setField: setJa } = useEntityTranslations("NEWS_ITEM", initial?.id, open);

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial));
      setLinkSelf(false);
      setVisibility(initial?.visibility ?? "PUBLIC");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  function set<K extends keyof ReturnType<typeof toFormState>>(key: K, value: ReturnType<typeof toFormState>[K]) {
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
      const payload = {
        ...(canSetVisibility ? { ...fields, visibility } : fields),
        ...(initial ? { translations: { ja } } : {}),
      } as NewsFormFields;
      await onSubmit(payload, linkSelf);
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
            <label htmlFor="news_date">{t("news.displayDateLabel")}</label>
            <input
              id="news_date"
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
              placeholder={t("news.displayDatePlaceholder")}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="news_sortDate">{t("news.sortDateLabel")}</label>
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
            <label htmlFor="news_type">{t("news.typeLabel")}</label>
            <select id="news_type" value={values.type} onChange={(e) => set("type", e.target.value)}>
              {typeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="news_emoji">{t("news.emojiLabel")}</label>
            <input id="news_emoji" value={values.emoji} onChange={(e) => set("emoji", e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="news_title">{t("news.titleFieldLabel")}</label>
          <input id="news_title" value={values.title} onChange={(e) => set("title", e.target.value)} required />
        </div>

        <div className="form-group">
          <label htmlFor="news_description">{t("news.descriptionFieldLabel")}</label>
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
            <span>{t("news.linkSelfCheckbox")}</span>
          </label>
        )}

        {initial && (
          <fieldset className="form-fieldset">
            <legend>{t("lang.ja.name")}</legend>
            <div className="form-group">
              <label htmlFor="news_title_ja">
                {t("common.optional")}: {t("news.titleJaLabel")}
              </label>
              <input id="news_title_ja" value={ja.title ?? ""} onChange={(e) => setJa("title", e.target.value)} maxLength={200} />
            </div>
            <div className="form-group">
              <label htmlFor="news_description_ja">
                {t("common.optional")}: {t("news.descriptionJaLabel")}
              </label>
              <textarea id="news_description_ja" value={ja.description ?? ""} onChange={(e) => setJa("description", e.target.value)} />
            </div>
          </fieldset>
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

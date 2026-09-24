import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createEventSchema, EVENT_KINDS, type EventKind, type LabEvent, type ProjectSummary, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { EVENT_KIND_LABEL_KEY } from "../i18n/labels";
import { apiErrorMessage, knownMessage } from "../i18n/errorMessages";
import { useEntityTranslations } from "../hooks/useEntityTranslations";

/** What the form hands to the page: the validated event fields, ready to send. */
export interface EventFormPayload {
  title: string;
  description: string;
  location: string;
  url: string;
  kind: EventKind;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  visibility?: Visibility;
  projectId?: string | null;
  translations: { ja: Record<string, string> };
}

interface EventFormModalProps {
  open: boolean;
  title: string;
  /** Existing event when editing; omit/null to create a new one. */
  initial?: LabEvent | null;
  /** Lab managers/admins only; the API rejects anyone else who sends it. */
  canSetVisibility?: boolean;
  /** Lab managers/admins only: link the event to a project the manager picks from this list. */
  projects?: Pick<ProjectSummary, "id" | "title">[] | null;
  onClose: () => void;
  onSubmit: (payload: EventFormPayload) => Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO instant -> the value a <input type="datetime-local"> expects, in the viewer's own time zone. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface FormState {
  title: string;
  description: string;
  location: string;
  url: string;
  kind: EventKind;
  allDay: boolean;
  start: string;
  end: string;
}

function toFormState(initial?: LabEvent | null): FormState {
  if (!initial) return { title: "", description: "", location: "", url: "", kind: "SEMINAR", allDay: false, start: "", end: "" };
  return {
    title: initial.title,
    description: initial.description,
    location: initial.location,
    url: initial.url,
    kind: initial.kind,
    allDay: initial.allDay,
    // An all-day event is a calendar date (UTC midnight); a timed one is shown in the viewer's time zone.
    start: initial.allDay ? initial.startsAt.slice(0, 10) : toLocalInput(initial.startsAt),
    end: initial.endsAt ? (initial.allDay ? initial.endsAt.slice(0, 10) : toLocalInput(initial.endsAt)) : "",
  };
}

/** Form value -> the ISO instant the API wants ("" -> null). All-day values are dates, sent as UTC midnight. */
function toInstant(value: string, allDay: boolean): string | null {
  if (!value) return null;
  if (allDay) return `${value}T00:00:00.000Z`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
}

// The schema's field name -> the form control's id, so an error can be tied to the control it is about.
const FIELD_ID: Record<string, string> = {
  title: "event_title",
  description: "event_description",
  location: "event_location",
  url: "event_url",
  kind: "event_kind",
  startsAt: "event_start",
  endsAt: "event_end",
};

/** The schema fields in the order their controls appear in the form. */
const FIELD_ORDER = ["title", "kind", "startsAt", "endsAt", "location", "description", "url"];

export function EventFormModal({ open, title, initial, canSetVisibility = false, projects, onClose, onSubmit }: EventFormModalProps) {
  const t = useT();
  const [values, setValues] = useState(() => toFormState(initial));
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? "LAB_ONLY");
  const [projectId, setProjectId] = useState<string>(initial?.project?.id ?? "");
  const [error, setError] = useState<{ message: string; fieldId?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { values: ja, setField: setJa } = useEntityTranslations("EVENT", initial?.id, open);

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial));
      setVisibility(initial?.visibility ?? "LAB_ONLY");
      setProjectId(initial?.project?.id ?? "");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  /** Switching between date-only and date+time keeps what was typed where it can. */
  function setAllDay(allDay: boolean) {
    setValues((v) => {
      const conv = (s: string) => (allDay ? s.slice(0, 10) : s && s.length === 10 ? `${s}T09:00` : s);
      return { ...v, allDay, start: conv(v.start), end: conv(v.end) };
    });
  }

  function fail(message: string, field?: string) {
    const fieldId = field ? FIELD_ID[field] : undefined;
    setError({ message, fieldId });
  }

  // Move focus to the control the error is about once the error (and its aria-invalid) has rendered.
  useEffect(() => {
    if (error?.fieldId) document.getElementById(error.fieldId)?.focus();
  }, [error]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // The shared schema is the one source of the rules; a missing start goes in as `undefined` so it
    // reports "Start is required." like the API would.
    const candidate = {
      title: values.title,
      description: values.description,
      location: values.location,
      url: values.url,
      kind: values.kind,
      allDay: values.allDay,
      startsAt: toInstant(values.start, values.allDay) ?? undefined,
      endsAt: toInstant(values.end, values.allDay),
    };
    const validation = createEventSchema.safeParse(candidate);
    if (!validation.success) {
      // Report the problem highest on the form first, so focus moves down the page in reading order.
      const rank = (issue: { path: (string | number)[] }) => {
        const i = FIELD_ORDER.indexOf(String(issue.path[0] ?? ""));
        return i < 0 ? FIELD_ORDER.length : i;
      };
      const issue = [...validation.error.issues].sort((a, b) => rank(a) - rank(b))[0];
      return fail(issue ? knownMessage(issue.message, t) : t("common.checkForm"), issue ? String(issue.path[0] ?? "") : undefined);
    }

    setSubmitting(true);
    try {
      const { title: vt, description, location, url, kind, allDay } = validation.data;
      await onSubmit({
        title: vt,
        description,
        location,
        url,
        kind,
        allDay,
        startsAt: validation.data.startsAt,
        endsAt: validation.data.endsAt ?? null,
        ...(canSetVisibility ? { visibility } : {}),
        ...(projects ? { projectId: projectId || null } : {}),
        translations: { ja },
      });
      onClose();
    } catch (err) {
      setError({ message: apiErrorMessage(err, t) });
    } finally {
      setSubmitting(false);
    }
  }

  const invalid = (id: string) => (error?.fieldId === id ? { "aria-invalid": true as const, "aria-describedby": "event_form_error" } : {});
  const dateType = values.allDay ? "date" : "datetime-local";

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && (
        <div className="form-error" role="alert" id="event_form_error">
          {error.message}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="event_title">{t("events.titleLabel")}</label>
          <input id="event_title" value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required {...invalid("event_title")} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="event_kind">{t("events.kindLabel")}</label>
            <select id="event_kind" value={values.kind} onChange={(e) => set("kind", e.target.value as EventKind)}>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(EVENT_KIND_LABEL_KEY[k])}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="check-row" htmlFor="event_allday">
              <input id="event_allday" type="checkbox" checked={values.allDay} onChange={(e) => setAllDay(e.target.checked)} />
              <span>{t("events.allDayLabel")}</span>
            </label>
          </div>
        </div>

        <div className="form-row form-row--stack">
          <div className="form-group">
            <label htmlFor="event_start">{values.allDay ? t("events.startDateLabel") : t("events.startLabel")}</label>
            <input id="event_start" type={dateType} value={values.start} onChange={(e) => set("start", e.target.value)} required {...invalid("event_start")} />
          </div>
          <div className="form-group">
            <label htmlFor="event_end">{values.allDay ? t("events.endDateLabel") : t("events.endLabel")}</label>
            <input id="event_end" type={dateType} value={values.end} onChange={(e) => set("end", e.target.value)} {...invalid("event_end")} />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="event_location">{t("events.locationLabel")}</label>
          <input id="event_location" value={values.location} onChange={(e) => set("location", e.target.value)} maxLength={200} {...invalid("event_location")} />
        </div>

        <div className="form-group">
          <label htmlFor="event_description">{t("events.descriptionLabel")}</label>
          <textarea id="event_description" value={values.description} onChange={(e) => set("description", e.target.value)} maxLength={5000} {...invalid("event_description")} />
        </div>

        <div className="form-group">
          <label htmlFor="event_url">{t("events.urlLabel")}</label>
          <input id="event_url" type="url" inputMode="url" value={values.url} onChange={(e) => set("url", e.target.value)} placeholder={t("events.urlPlaceholder")} {...invalid("event_url")} />
        </div>

        {projects && (
          <div className="form-group">
            <label htmlFor="event_project">{t("events.projectLabel")}</label>
            <select id="event_project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t("events.projectNone")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {canSetVisibility ? (
          <VisibilityField id="event_visibility" value={visibility} onChange={setVisibility} />
        ) : (
          !initial && <p className="form-hint">{t("events.memberVisibilityNote")}</p>
        )}

        <fieldset className="form-fieldset">
          <legend>{t("lang.ja.name")}</legend>
          <div className="form-group">
            <label htmlFor="event_title_ja">
              {t("common.optional")}: {t("events.titleJaLabel")}
            </label>
            <input id="event_title_ja" value={ja.title ?? ""} onChange={(e) => setJa("title", e.target.value)} maxLength={200} />
          </div>
          <div className="form-group">
            <label htmlFor="event_description_ja">
              {t("common.optional")}: {t("events.descriptionJaLabel")}
            </label>
            <textarea id="event_description_ja" value={ja.description ?? ""} onChange={(e) => setJa("description", e.target.value)} maxLength={5000} />
          </div>
        </fieldset>

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

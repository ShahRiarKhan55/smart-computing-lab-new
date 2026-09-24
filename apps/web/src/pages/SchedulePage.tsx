import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { Icon } from "../components/Icon";
import { useT } from "../i18n/LocaleContext";

// Same shared lab calendar the reference schedule.html embeds. There is no
// backend data behind this page — it is purely a Google Calendar embed.
const LAB_CALENDAR_EMAIL = "susmartcomputinglab@gmail.com";

const EMBED_SRC = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(LAB_CALENDAR_EMAIL)}&ctz=local`;
const ADD_EVENT_URL = `https://calendar.google.com/calendar/u/0/r/eventedit?src=${encodeURIComponent(LAB_CALENDAR_EMAIL)}`;

/** Login-only; the route is wrapped in <ProtectedRoute> in App.tsx (UX gate — the calendar itself is Google's). */
export function SchedulePage() {
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t("schedule.eyebrow")} title={t("schedule.pageTitle")} description={t("schedule.pageDescription")} />
      <div className="container">
        <AdminBar
          text={t("schedule.viewingCalendar")}
          actions={
            <a href={ADD_EVENT_URL} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--sm">
              + {t("schedule.addEvent")} <Icon name="external" size={13} />
              <span className="sr-only">{t("publications.opensInNewTab")}</span>
            </a>
          }
        />

        <div className="calendar-frame">
          <iframe title={t("schedule.calendarIframeTitle")} src={EMBED_SRC} loading="lazy" scrolling="no" />
        </div>
      </div>
    </>
  );
}

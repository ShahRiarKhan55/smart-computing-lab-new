import { useState } from "react";
import { Link } from "react-router-dom";
import { isEventPast, type LabEvent } from "@scl/shared";
import { Badge } from "./Badge";
import { CardEditControls } from "./CardEditControls";
import { Icon } from "./Icon";
import { VisibilityBadge } from "./VisibilityField";
import { formatEventWhen } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";
import { EVENT_KIND_LABEL_KEY } from "../i18n/labels";

interface EventCardProps {
  event: LabEvent;
  /** Show the edit/delete controls (only when the server said this viewer may). */
  onEdit?: () => void;
  onDelete?: () => void;
}

/** A past event is muted AND says "Past": state is never colour alone. */
export function EventCard({ event: e, onEdit, onDelete }: EventCardProps) {
  const { locale, t } = useLocale();
  const [now] = useState(() => Date.now()); // fixed at mount: a card does not flip from upcoming to past under the reader
  const past = isEventPast(e, now);
  const ongoing = !past && new Date(e.startsAt).getTime() <= now;
  const editable = e.canEdit && !!onEdit;
  const when = formatEventWhen(e, locale);
  const byline = [e.organizer?.name, e.project?.title].filter(Boolean).join(" · ");

  return (
    <article className={`card card--interactive event-card${past ? " event-card--past" : ""}${editable ? " card--editable" : ""}`}>
      {editable && <CardEditControls onEdit={onEdit} onDelete={e.canDelete ? onDelete : undefined} subject={e.title} />}
      <div className="card__top">
        <Badge variant="brand" upper>
          {t(EVENT_KIND_LABEL_KEY[e.kind])}
        </Badge>
        {ongoing && (
          <Badge variant="info" upper>
            {t("events.happeningNow")}
          </Badge>
        )}
        {past && (
          <Badge upper>{t("events.pastBadge")}</Badge>
        )}
        {e.allDay && <Badge>{t("events.allDayBadge")}</Badge>}
        <VisibilityBadge visibility={e.visibility} />
      </div>
      <h3 className="card__title event-card__title">
        <Link to={`/events/${e.id}`}>{e.title}</Link>
      </h3>
      <p className="event-card__line">
        <Icon name="clock" size={14} />
        <time dateTime={e.startsAt}>{when}</time>
      </p>
      {e.location && (
        <p className="event-card__line">
          <Icon name="map-pin" size={14} />
          <span>{e.location}</span>
        </p>
      )}
      {e.description && <p className="card__text event-card__desc">{e.description}</p>}
      {byline && <p className="card__meta event-card__byline">{byline}</p>}
    </article>
  );
}

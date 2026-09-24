import { Icon } from "./Icon";
import { useT } from "../i18n/LocaleContext";

interface CardEditControlsProps {
  onEdit: () => void;
  onDelete?: () => void;
  onManageAuthors?: () => void;
  /** What the buttons act on ("Edit Deep Learning"), so a screen reader hears more than "Edit". */
  subject?: string;
}

/** The edit / delete icon buttons laid over the top-right corner of an editable card. */
export function CardEditControls({ onEdit, onDelete, onManageAuthors, subject }: CardEditControlsProps) {
  const t = useT();
  return (
    <div className="card-edit-btn">
      {onManageAuthors && (
        <button
          className="icon-btn"
          title={t("common.manageAuthors")}
          aria-label={subject ? t("common.manageAuthorsOfAria", { subject }) : t("common.manageAuthors")}
          type="button"
          onClick={onManageAuthors}
        >
          <Icon name="users" />
        </button>
      )}
      <button className="icon-btn" title={t("common.edit")} aria-label={subject ? t("common.editAria", { subject }) : t("common.edit")} type="button" onClick={onEdit}>
        <Icon name="edit" />
      </button>
      {onDelete && (
        <button
          className="icon-btn icon-btn--danger"
          title={t("common.delete")}
          aria-label={subject ? t("common.deleteAria", { subject }) : t("common.delete")}
          type="button"
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}

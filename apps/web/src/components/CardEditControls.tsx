import { Icon } from "./Icon";

interface CardEditControlsProps {
  onEdit: () => void;
  onDelete?: () => void;
  onManageAuthors?: () => void;
  /** What the buttons act on ("Edit Deep Learning"), so a screen reader hears more than "Edit". */
  subject?: string;
}

/** The edit / delete icon buttons laid over the top-right corner of an editable card. */
export function CardEditControls({ onEdit, onDelete, onManageAuthors, subject }: CardEditControlsProps) {
  const label = (verb: string) => (subject ? `${verb} ${subject}` : verb);
  return (
    <div className="card-edit-btn">
      {onManageAuthors && (
        <button className="icon-btn" title="Manage authors" aria-label={label("Manage authors of")} type="button" onClick={onManageAuthors}>
          <Icon name="users" />
        </button>
      )}
      <button className="icon-btn" title="Edit" aria-label={label("Edit")} type="button" onClick={onEdit}>
        <Icon name="edit" />
      </button>
      {onDelete && (
        <button className="icon-btn icon-btn--danger" title="Delete" aria-label={label("Delete")} type="button" onClick={onDelete}>
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}

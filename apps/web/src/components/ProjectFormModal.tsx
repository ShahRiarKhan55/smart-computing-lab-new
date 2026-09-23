import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  createProjectSchema,
  type ProjectStatus,
  type ProjectSummary,
  type Visibility,
} from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";

/** What the form hands to the page. Manager-only fields are present only when `canManageSettings`. */
export type ProjectFormPayload = Record<string, unknown>;

interface ProjectFormModalProps {
  open: boolean;
  title: string;
  /** Existing project when editing; omit/null to create a new one. */
  initial?: ProjectSummary | null;
  /** Lab managers/admins: visibility, group, sort order, slug. A project lead edits the content fields only. */
  canManageSettings: boolean;
  groups: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (payload: ProjectFormPayload) => Promise<void>;
}

interface FormState {
  title: string;
  summary: string;
  description: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  visibility: Visibility;
  groupId: string;
  sortOrder: string;
  slug: string;
}

function toFormState(initial?: ProjectSummary | null): FormState {
  return {
    title: initial?.title ?? "",
    summary: initial?.summary ?? "",
    // The list/detail response carries `description` only on the detail shape.
    description: (initial as { description?: string } | null | undefined)?.description ?? "",
    status: initial?.status ?? "ACTIVE",
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
    // A new project starts internal; someone has to publish it on purpose.
    visibility: initial?.visibility ?? "LAB_ONLY",
    groupId: initial?.group?.id ?? "",
    sortOrder: String(initial?.sortOrder ?? 0),
    slug: "",
  };
}

export function ProjectFormModal({ open, title, initial, canManageSettings, groups, onClose, onSubmit }: ProjectFormModalProps) {
  const t = useT();
  const [values, setValues] = useState<FormState>(() => toFormState(initial));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial));
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

    const sortOrderText = values.sortOrder.trim();
    const validation = createProjectSchema.safeParse({
      title: values.title,
      summary: values.summary,
      description: values.description,
      status: values.status,
      startDate: values.startDate,
      endDate: values.endDate,
      ...(canManageSettings && {
        visibility: values.visibility,
        groupId: values.groupId || null,
        sortOrder: sortOrderText === "" ? 0 : Number(sortOrderText),
        slug: values.slug.trim() || undefined,
      }),
    });
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }
    const d = validation.data;
    const payload: ProjectFormPayload = {
      title: d.title,
      summary: d.summary,
      description: d.description,
      status: d.status,
      startDate: d.startDate,
      endDate: d.endDate,
      ...(canManageSettings && {
        visibility: d.visibility,
        groupId: d.groupId,
        sortOrder: d.sortOrder,
        ...(d.slug ? { slug: d.slug } : {}),
      }),
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="project_title">Title</label>
          <input id="project_title" value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required />
        </div>

        <div className="form-group">
          <label htmlFor="project_summary">Short summary (shown on the card)</label>
          <input id="project_summary" value={values.summary} onChange={(e) => set("summary", e.target.value)} maxLength={500} />
        </div>

        <div className="form-group">
          <label htmlFor="project_description">Description</label>
          <textarea id="project_description" value={values.description} onChange={(e) => set("description", e.target.value)} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="project_status">Status</label>
            <select id="project_status" value={values.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="project_startDate">Start date</label>
            <input id="project_startDate" type="date" value={values.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="project_endDate">End date</label>
            <input id="project_endDate" type="date" value={values.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </div>
        </div>

        {canManageSettings && (
          <>
            <VisibilityField id="project_visibility" value={values.visibility} onChange={(v) => set("visibility", v)} />
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="project_group">Research group</label>
                <select id="project_group" value={values.groupId} onChange={(e) => set("groupId", e.target.value)}>
                  <option value="">— No group —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="project_sortOrder">Sort order (lower shows first)</label>
                <input id="project_sortOrder" type="number" value={values.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="project_slug">URL name (optional, lowercase-with-hyphens; generated from the title if blank)</label>
              <input id="project_slug" value={values.slug} onChange={(e) => set("slug", e.target.value)} placeholder={initial ? "leave blank to keep the current one" : "e.g. wafer-test-ml"} />
            </div>
          </>
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

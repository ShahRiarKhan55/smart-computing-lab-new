import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createKnowledgeSchema, KNOWLEDGE_BODY_MAX, KNOWLEDGE_CATEGORIES, KNOWLEDGE_TITLE_MAX, type KnowledgeCategory, type KnowledgeDocSummary, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { KNOWLEDGE_CATEGORY_LABEL_KEY } from "../i18n/labels";
import { apiErrorMessage, knownMessage } from "../i18n/errorMessages";
import { useEntityTranslations } from "../hooks/useEntityTranslations";
import { useKnowledgeOptions } from "../hooks/useKnowledgeOptions";

/** What the form hands to the page: the validated fields, ready to send. Links are sent only when they changed. */
export interface KnowledgeFormPayload {
  title: string;
  body: string;
  category: KnowledgeCategory;
  visibility?: Visibility;
  projectId?: string | null;
  researchAreaId?: string | null;
  groupId?: string | null;
  teamMemberId?: string | null;
  translations: { ja: Record<string, string> };
}

interface KnowledgeFormModalProps {
  open: boolean;
  title: string;
  /** Existing document when editing; omit/null to create a new one. */
  initial?: KnowledgeDocSummary | null;
  /** Lab managers/admins only; the API rejects anyone else who sends it. */
  canSetVisibility?: boolean;
  /** Preselects a link when creating from a filtered list (e.g. /knowledge?project=<id>). */
  presetLinks?: { projectId?: string; researchAreaId?: string; groupId?: string; teamMemberId?: string };
  onClose: () => void;
  onSubmit: (payload: KnowledgeFormPayload) => Promise<void>;
}

// The schema's field name -> the form control's id, so an error can be tied to the control it is about.
const FIELD_ID: Record<string, string> = { title: "knowledge_title", body: "knowledge_body", category: "knowledge_category" };
/** The schema fields in the order their controls appear in the form. */
const FIELD_ORDER = ["title", "category", "body"];

interface Links {
  projectId: string;
  researchAreaId: string;
  groupId: string;
  teamMemberId: string;
}
const linksOf = (d?: KnowledgeDocSummary | null, preset?: KnowledgeFormModalProps["presetLinks"]): Links => ({
  projectId: d?.project?.id ?? preset?.projectId ?? "",
  researchAreaId: d?.researchArea?.id ?? preset?.researchAreaId ?? "",
  groupId: d?.group?.id ?? preset?.groupId ?? "",
  teamMemberId: d?.researcher?.id ?? preset?.teamMemberId ?? "",
});

export function KnowledgeFormModal({ open, title, initial, canSetVisibility = false, presetLinks, onClose, onSubmit }: KnowledgeFormModalProps) {
  const t = useT();
  const [values, setValues] = useState({ title: initial?.title ?? "", body: "", category: (initial?.category ?? "RESOURCE") as KnowledgeCategory });
  const [links, setLinks] = useState<Links>(() => linksOf(initial, presetLinks));
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? "LAB_ONLY");
  const [error, setError] = useState<{ message: string; fieldId?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { values: ja, setField: setJa, base, failed } = useEntityTranslations("KNOWLEDGE_DOC", initial?.id, open);
  const options = useKnowledgeOptions(open);

  useEffect(() => {
    if (open) {
      setValues({ title: initial?.title ?? "", body: "", category: (initial?.category ?? "RESOURCE") as KnowledgeCategory });
      setLinks(linksOf(initial, presetLinks));
      setVisibility(initial?.visibility ?? "LAB_ONLY");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // A page fetched in Japanese already carries the Japanese override in title/body; saving that back would
  // overwrite the English text. When editing, the entity's own ENGLISH text replaces the prefill (and the body,
  // which list cards do not carry at all, comes only from here). Saving stays disabled until it has arrived.
  const editing = Boolean(initial);
  useEffect(() => {
    if (!open || !base) return;
    setValues((v) => ({ ...v, ...(base.title != null ? { title: base.title } : {}), ...(base.body != null ? { body: base.body } : {}) }));
  }, [open, base]);
  const baseReady = !editing || base !== null;

  // Move focus to the control the error is about once the error (and its aria-invalid) has rendered.
  useEffect(() => {
    if (error?.fieldId) document.getElementById(error.fieldId)?.focus();
  }, [error]);

  function fail(message: string, field?: string) {
    setError({ message, fieldId: field ? FIELD_ID[field] : undefined });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!baseReady) return;

    // The shared schema is the one source of the rules.
    const validation = createKnowledgeSchema.safeParse({ title: values.title, body: values.body, category: values.category });
    if (!validation.success) {
      const rank = (issue: { path: (string | number)[] }) => {
        const i = FIELD_ORDER.indexOf(String(issue.path[0] ?? ""));
        return i < 0 ? FIELD_ORDER.length : i;
      };
      const issue = [...validation.error.issues].sort((a, b) => rank(a) - rank(b))[0];
      return fail(issue ? knownMessage(issue.message, t) : t("common.checkForm"), issue ? String(issue.path[0] ?? "") : undefined);
    }

    // Only links the person actually changed are sent: a link to something they cannot see (shown as "None")
    // must never be cleared just because the form could not display it.
    const before = linksOf(initial, presetLinks);
    const changed = (k: keyof Links) => (initial ? links[k] !== before[k] : links[k] !== "");
    setSubmitting(true);
    try {
      await onSubmit({
        title: validation.data.title,
        body: validation.data.body,
        category: validation.data.category,
        ...(canSetVisibility ? { visibility } : {}),
        ...(changed("projectId") ? { projectId: links.projectId || null } : {}),
        ...(changed("researchAreaId") ? { researchAreaId: links.researchAreaId || null } : {}),
        ...(changed("groupId") ? { groupId: links.groupId || null } : {}),
        ...(changed("teamMemberId") ? { teamMemberId: links.teamMemberId || null } : {}),
        translations: { ja },
      });
      onClose();
    } catch (err) {
      setError({ message: apiErrorMessage(err, t) });
    } finally {
      setSubmitting(false);
    }
  }

  const invalid = (id: string) => (error?.fieldId === id ? { "aria-invalid": true as const, "aria-describedby": "knowledge_form_error" } : {});
  const relation = (id: string, label: string, key: keyof Links, list: { id: string; label: string }[] | undefined) => (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={links[key]} onChange={(e) => setLinks((l) => ({ ...l, [key]: e.target.value }))}>
        <option value="">{t("knowledge.noneOption")}</option>
        {(list ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && (
        <div className="form-error" role="alert" id="knowledge_form_error">
          {error.message}
        </div>
      )}
      {editing && failed && (
        <div className="form-error" role="alert">
          {t("knowledge.couldNotLoad")}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="knowledge_title">{t("knowledge.titleLabel")}</label>
          <input id="knowledge_title" value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} maxLength={KNOWLEDGE_TITLE_MAX} required {...invalid("knowledge_title")} />
        </div>

        <div className="form-group">
          <label htmlFor="knowledge_category">{t("knowledge.categoryLabel")}</label>
          <select id="knowledge_category" value={values.category} onChange={(e) => setValues((v) => ({ ...v, category: e.target.value as KnowledgeCategory }))}>
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(KNOWLEDGE_CATEGORY_LABEL_KEY[c])}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="knowledge_body">{t("knowledge.bodyLabel")}</label>
          <textarea
            id="knowledge_body"
            className="knowledge-form__body"
            value={values.body}
            onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))}
            maxLength={KNOWLEDGE_BODY_MAX}
            aria-describedby="knowledge_body_hint"
            {...invalid("knowledge_body")}
          />
          <p className="form-hint" id="knowledge_body_hint">
            {t("knowledge.bodyHint")}
          </p>
        </div>

        <fieldset className="form-fieldset">
          <legend>{t("knowledge.relationsLegend")}</legend>
          {relation("knowledge_project", t("knowledge.projectLabel"), "projectId", options?.projects)}
          {relation("knowledge_area", t("knowledge.areaLabel"), "researchAreaId", options?.areas)}
          {relation("knowledge_group", t("knowledge.groupLabel"), "groupId", options?.groups)}
          {relation("knowledge_researcher", t("knowledge.researcherLabel"), "teamMemberId", options?.researchers)}
        </fieldset>

        {canSetVisibility ? <VisibilityField id="knowledge_visibility" value={visibility} onChange={setVisibility} /> : !initial && <p className="form-hint">{t("knowledge.memberVisibilityNote")}</p>}

        <fieldset className="form-fieldset">
          <legend>{t("lang.ja.name")}</legend>
          <div className="form-group">
            <label htmlFor="knowledge_title_ja">
              {t("common.optional")}: {t("knowledge.titleJaLabel")}
            </label>
            <input id="knowledge_title_ja" value={ja.title ?? ""} onChange={(e) => setJa("title", e.target.value)} maxLength={KNOWLEDGE_TITLE_MAX} />
          </div>
          <div className="form-group">
            <label htmlFor="knowledge_body_ja">
              {t("common.optional")}: {t("knowledge.bodyJaLabel")}
            </label>
            <textarea id="knowledge_body_ja" className="knowledge-form__body" value={ja.body ?? ""} onChange={(e) => setJa("body", e.target.value)} maxLength={KNOWLEDGE_BODY_MAX} />
          </div>
        </fieldset>

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting || !baseReady}>
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

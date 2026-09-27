import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  createResourceSchema,
  RESOURCE_DESCRIPTION_MAX,
  RESOURCE_ENVIRONMENT_MAX,
  RESOURCE_METADATA_VALUE_MAX,
  RESOURCE_NAME_MAX,
  RESOURCE_SHORT_MAX,
  RESOURCE_TYPES,
  RESOURCE_TYPE_METADATA,
  type ResourceDetail,
  type ResourceMetadataKey,
  type ResourceSummary,
  type ResourceType,
  type Visibility,
} from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { RESOURCE_METADATA_LABEL_KEY, RESOURCE_TYPE_LABEL_KEY } from "../i18n/labels";
import { apiErrorMessage, knownMessage } from "../i18n/errorMessages";
import { apiFetch } from "../lib/api";
import { useEntityTranslations } from "../hooks/useEntityTranslations";
import { useResourceOptions, type ResourceOptions } from "../hooks/useResourceOptions";

/** What the form hands to the page: the validated fields, ready to send. Links and projects are sent only when they changed. */
export interface ResourceFormPayload {
  name: string;
  resourceType: ResourceType;
  description: string;
  version: string;
  vendor: string;
  identifier: string;
  url: string;
  environment: string;
  metadata: Record<string, string>;
  visibility?: Visibility;
  projectIds?: string[];
  researchAreaId?: string | null;
  groupId?: string | null;
  knowledgeDocId?: string | null;
  publicationId?: string | null;
  eventId?: string | null;
  teamMemberId?: string | null;
  translations: { ja: Record<string, string> };
}

interface ResourceFormModalProps {
  open: boolean;
  title: string;
  /** Existing resource when editing; omit/null to create a new one. */
  initial?: ResourceSummary | null;
  /** Lab managers/admins only; the API rejects anyone else who sends it. */
  canSetVisibility?: boolean;
  /** Preselects a link when creating from a filtered list (e.g. /resources?project=<id>). */
  presetLinks?: { projectId?: string; researchAreaId?: string; groupId?: string; teamMemberId?: string; knowledgeDocId?: string; publicationId?: string };
  /** The page's already-loaded picklists, so opening the form does not fetch them again; omitted = the form loads its own. */
  options?: ResourceOptions | null;
  onClose: () => void;
  onSubmit: (payload: ResourceFormPayload) => Promise<void>;
}

// The schema's field name -> the form control's id, so an error can be tied to the control it is about.
const FIELD_ID: Record<string, string> = {
  name: "resource_name",
  resourceType: "resource_type",
  description: "resource_description",
  version: "resource_version",
  vendor: "resource_vendor",
  identifier: "resource_identifier",
  url: "resource_url",
  environment: "resource_environment",
};
/** The schema fields in the order their controls appear in the form. */
const FIELD_ORDER = ["name", "resourceType", "description", "version", "vendor", "identifier", "url", "environment", "metadata"];
/** Metadata that is a sentence or a list rather than a token gets a small textarea. */
const LONG_METADATA: readonly ResourceMetadataKey[] = ["license", "collectionMethod", "configuration", "requirements", "measurementConditions"];

interface Links {
  researchAreaId: string;
  groupId: string;
  knowledgeDocId: string;
  publicationId: string;
  eventId: string;
  teamMemberId: string;
}
type Preset = NonNullable<ResourceFormModalProps["presetLinks"]>;
const linksOf = (d: ResourceDetail | null, preset?: Preset): Links => ({
  researchAreaId: d ? (d.researchArea?.id ?? "") : (preset?.researchAreaId ?? ""),
  groupId: d ? (d.group?.id ?? "") : (preset?.groupId ?? ""),
  knowledgeDocId: d ? (d.knowledgeDoc?.id ?? "") : (preset?.knowledgeDocId ?? ""),
  publicationId: d ? (d.publication?.id ?? "") : (preset?.publicationId ?? ""),
  eventId: d ? (d.event?.id ?? "") : "",
  teamMemberId: d ? (d.researcher?.id ?? "") : (preset?.teamMemberId ?? ""),
});
const projectsOf = (d: ResourceDetail | null, preset?: Preset): string[] => (d ? d.projects.map((p) => p.id) : preset?.projectId ? [preset.projectId] : []);

export function ResourceFormModal({ open, title, initial, canSetVisibility = false, presetLinks, options: given, onClose, onSubmit }: ResourceFormModalProps) {
  const t = useT();
  const editing = Boolean(initial);
  const [values, setValues] = useState({ name: initial?.name ?? "", resourceType: (initial?.resourceType ?? "OTHER") as ResourceType, description: "", version: "", vendor: "", identifier: "", url: "", environment: "" });
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Links>(() => linksOf(null, presetLinks));
  const [projectIds, setProjectIds] = useState<string[]>(() => projectsOf(null, presetLinks));
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? "LAB_ONLY");
  const [error, setError] = useState<{ message: string; fieldId?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The full record (a list card carries only a summary) and the English base text, both needed before an edit can be saved.
  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const { values: ja, setField: setJa, base, failed } = useEntityTranslations("LAB_RESOURCE", initial?.id, open);
  const ownOptions = useResourceOptions(open && given === undefined);
  const options = given === undefined ? ownOptions : given;

  useEffect(() => {
    if (open) {
      setValues({ name: initial?.name ?? "", resourceType: (initial?.resourceType ?? "OTHER") as ResourceType, description: "", version: initial?.version ?? "", vendor: initial?.vendor ?? "", identifier: initial?.identifier ?? "", url: initial?.url ?? "", environment: "" });
      setMetadata({});
      setLinks(linksOf(null, presetLinks));
      setProjectIds(projectsOf(null, presetLinks));
      setVisibility(initial?.visibility ?? "LAB_ONLY");
      setError(null);
      setDetail(null);
      setDetailFailed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // Editing: load the full record (links, projects, metadata). Its translatable text may be the Japanese override
  // (the page's locale), so name / description / environment come ONLY from `base` below, never from here.
  const initialId = initial?.id;
  useEffect(() => {
    if (!open || !initialId) return;
    let cancelled = false;
    apiFetch<ResourceDetail>(`/resources/${initialId}`)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setDetailFailed(false);
        setValues((v) => ({ ...v, resourceType: d.resourceType, version: d.version, vendor: d.vendor, identifier: d.identifier, url: d.url }));
        setMetadata({ ...d.metadata });
        setLinks(linksOf(d));
        setProjectIds(projectsOf(d));
        if (d.visibility) setVisibility(d.visibility);
      })
      .catch(() => {
        if (!cancelled) setDetailFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialId]);

  // A page fetched in Japanese already carries the Japanese override in name/description/environment; saving that back
  // would overwrite the English text. The entity's own ENGLISH text replaces the prefill and saving stays disabled until it has arrived.
  useEffect(() => {
    if (!open || !base) return;
    setValues((v) => ({
      ...v,
      ...(base.name != null ? { name: base.name } : {}),
      ...(base.description != null ? { description: base.description } : {}),
      ...(base.environment != null ? { environment: base.environment } : {}),
    }));
  }, [open, base]);
  const ready = !editing || (base !== null && detail !== null);

  // Move focus to the control the error is about once the error (and its aria-invalid) has rendered.
  useEffect(() => {
    if (error?.fieldId) document.getElementById(error.fieldId)?.focus();
  }, [error]);

  function fail(message: string, fieldId?: string) {
    setError({ message, fieldId });
  }

  const allowedMeta = RESOURCE_TYPE_METADATA[values.resourceType];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ready) return;

    // Only the metadata this type may carry is sent (switching type keeps what still fits and drops the rest).
    const meta: Record<string, string> = {};
    for (const key of allowedMeta) if ((metadata[key] ?? "").trim() !== "") meta[key] = metadata[key];

    // The shared schema is the one source of the rules.
    const validation = createResourceSchema.safeParse({ ...values, metadata: meta });
    if (!validation.success) {
      const rank = (issue: { path: (string | number)[] }) => {
        const i = FIELD_ORDER.indexOf(String(issue.path[0] ?? ""));
        return i < 0 ? FIELD_ORDER.length : i;
      };
      const issue = [...validation.error.issues].sort((a, b) => rank(a) - rank(b))[0];
      const field = issue ? String(issue.path[0] ?? "") : "";
      const metaKey = field === "metadata" ? (issue.path[1] as string | undefined) ?? allowedMeta[0] : undefined;
      return fail(issue ? knownMessage(issue.message, t) : t("common.checkForm"), field === "metadata" ? (metaKey ? `resource_meta_${metaKey}` : undefined) : FIELD_ID[field]);
    }

    // Only links the person actually changed are sent: a link to something they cannot see (shown as "None")
    // must never be cleared just because the form could not display it.
    const before = linksOf(detail, presetLinks);
    const linkChanged = (k: keyof Links) => (editing ? links[k] !== before[k] : links[k] !== "");
    const beforeProjects = projectsOf(detail, presetLinks);
    const projectsChanged = editing ? beforeProjects.length !== projectIds.length || beforeProjects.some((id) => !projectIds.includes(id)) : projectIds.length > 0;
    const d = validation.data;
    setSubmitting(true);
    try {
      await onSubmit({
        name: d.name,
        resourceType: d.resourceType,
        description: d.description,
        version: d.version,
        vendor: d.vendor,
        identifier: d.identifier,
        url: d.url,
        environment: d.environment,
        metadata: d.metadata ?? {},
        ...(canSetVisibility ? { visibility } : {}),
        ...(projectsChanged ? { projectIds } : {}),
        ...(linkChanged("researchAreaId") ? { researchAreaId: links.researchAreaId || null } : {}),
        ...(linkChanged("groupId") ? { groupId: links.groupId || null } : {}),
        ...(linkChanged("knowledgeDocId") ? { knowledgeDocId: links.knowledgeDocId || null } : {}),
        ...(linkChanged("publicationId") ? { publicationId: links.publicationId || null } : {}),
        ...(linkChanged("eventId") ? { eventId: links.eventId || null } : {}),
        ...(linkChanged("teamMemberId") ? { teamMemberId: links.teamMemberId || null } : {}),
        translations: { ja },
      });
      onClose();
    } catch (err) {
      setError({ message: apiErrorMessage(err, t) });
    } finally {
      setSubmitting(false);
    }
  }

  // aria-invalid + a description that names the error (and the field's own hint, when it has one) on the control the error is about.
  const invalid = (id: string, hintId?: string) => ({
    ...(error?.fieldId === id ? { "aria-invalid": true as const } : {}),
    ...(error?.fieldId === id || hintId ? { "aria-describedby": [hintId, error?.fieldId === id ? "resource_form_error" : undefined].filter(Boolean).join(" ") } : {}),
  });
  const text = (id: string, label: string, key: "name" | "version" | "vendor" | "identifier" | "url", max: number, extra?: { type?: string; hint?: string; required?: boolean }) => (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={extra?.type ?? "text"}
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        maxLength={max}
        required={extra?.required}
        {...invalid(id, extra?.hint ? `${id}_hint` : undefined)}
      />
      {extra?.hint && (
        <p className="form-hint" id={`${id}_hint`}>
          {extra.hint}
        </p>
      )}
    </div>
  );
  const relation = (id: string, label: string, key: keyof Links, list: { id: string; label: string }[] | undefined, current: { id: string; title: string } | null | undefined) => {
    // An already-linked record that is not among the picklist's rows (e.g. beyond the newest 50 documents) is still offered.
    const rows = list ?? [];
    const extra = current && !rows.some((o) => o.id === current.id) ? [{ id: current.id, label: current.title }] : [];
    return (
      <div className="form-group">
        <label htmlFor={id}>{label}</label>
        <select id={id} value={links[key]} onChange={(e) => setLinks((l) => ({ ...l, [key]: e.target.value }))}>
          <option value="">{t("resource.noneOption")}</option>
          {[...extra, ...rows].map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      {error && (
        <div className="form-error" role="alert" id="resource_form_error">
          {error.message}
        </div>
      )}
      {editing && (failed || detailFailed) && (
        <div className="form-error" role="alert">
          {t("resource.couldNotLoad")}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        {text("resource_name", t("resource.nameLabel"), "name", RESOURCE_NAME_MAX, { required: true })}

        <div className="form-group">
          <label htmlFor="resource_type">{t("resource.typeLabel")}</label>
          <select id="resource_type" value={values.resourceType} onChange={(e) => setValues((v) => ({ ...v, resourceType: e.target.value as ResourceType }))}>
            {RESOURCE_TYPES.map((r) => (
              <option key={r} value={r}>
                {t(RESOURCE_TYPE_LABEL_KEY[r])}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="resource_description">{t("resource.descriptionLabel")}</label>
          <textarea
            id="resource_description"
            className="resource-form__text"
            value={values.description}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            maxLength={RESOURCE_DESCRIPTION_MAX}
            {...invalid("resource_description", "resource_description_hint")}
          />
          <p className="form-hint" id="resource_description_hint">
            {t("resource.descriptionHint")}
          </p>
        </div>

        {text("resource_version", t("resource.versionLabel"), "version", RESOURCE_SHORT_MAX)}
        {text("resource_vendor", t("resource.vendorLabel"), "vendor", RESOURCE_SHORT_MAX)}
        {text("resource_identifier", t("resource.identifierLabel"), "identifier", RESOURCE_SHORT_MAX)}
        {text("resource_url", t("resource.urlLabel"), "url", 2048, { type: "url", hint: t("resource.urlHint") })}

        {allowedMeta.length > 0 && (
          <fieldset className="form-fieldset">
            <legend>{t("resource.metaLegend")}</legend>
            {allowedMeta.map((key) => {
              const id = `resource_meta_${key}`;
              const common = {
                id,
                value: metadata[key] ?? "",
                onChange: (e: { target: { value: string } }) => setMetadata((m) => ({ ...m, [key]: e.target.value })),
                maxLength: RESOURCE_METADATA_VALUE_MAX,
                ...invalid(id),
              };
              return (
                <div className="form-group" key={key}>
                  <label htmlFor={id}>{t(RESOURCE_METADATA_LABEL_KEY[key])}</label>
                  {LONG_METADATA.includes(key) ? <textarea className="resource-form__meta" {...common} /> : <input {...common} />}
                </div>
              );
            })}
          </fieldset>
        )}

        <div className="form-group">
          <label htmlFor="resource_environment">{t("resource.environmentLabel")}</label>
          <textarea
            id="resource_environment"
            className="resource-form__text"
            value={values.environment}
            onChange={(e) => setValues((v) => ({ ...v, environment: e.target.value }))}
            maxLength={RESOURCE_ENVIRONMENT_MAX}
            {...invalid("resource_environment", "resource_environment_hint")}
          />
          <p className="form-hint" id="resource_environment_hint">
            {t("resource.environmentHint")}
          </p>
        </div>

        <fieldset className="form-fieldset">
          <legend>{t("resource.projectsLegend")}</legend>
          {options && options.projects.length === 0 ? (
            <p className="form-hint">{t("resource.projectsEmpty")}</p>
          ) : (
            <div className="resource-form__projects">
              {(options?.projects ?? []).map((p) => (
                <label className="check-row" key={p.id}>
                  <input
                    type="checkbox"
                    checked={projectIds.includes(p.id)}
                    onChange={(e) => setProjectIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)))}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="form-fieldset">
          <legend>{t("resource.relationsLegend")}</legend>
          {relation("resource_area", t("resource.areaLabel"), "researchAreaId", options?.areas, detail?.researchArea)}
          {relation("resource_group", t("resource.groupLabel"), "groupId", options?.groups, detail?.group)}
          {relation("resource_doc", t("resource.docLabel"), "knowledgeDocId", options?.docs, detail?.knowledgeDoc)}
          {relation("resource_publication", t("resource.publicationLabel"), "publicationId", options?.publications, detail?.publication)}
          {relation("resource_event", t("resource.eventLabel"), "eventId", options?.events, detail?.event)}
          {relation("resource_researcher", t("resource.researcherLabel"), "teamMemberId", options?.researchers, detail?.researcher ? { id: detail.researcher.id, title: detail.researcher.name } : null)}
        </fieldset>

        {canSetVisibility ? <VisibilityField id="resource_visibility" value={visibility} onChange={setVisibility} /> : !initial && <p className="form-hint">{t("resource.memberVisibilityNote")}</p>}

        <fieldset className="form-fieldset">
          <legend>{t("lang.ja.name")}</legend>
          <div className="form-group">
            <label htmlFor="resource_name_ja">
              {t("common.optional")}: {t("resource.nameJaLabel")}
            </label>
            <input id="resource_name_ja" value={ja.name ?? ""} onChange={(e) => setJa("name", e.target.value)} maxLength={RESOURCE_NAME_MAX} />
          </div>
          <div className="form-group">
            <label htmlFor="resource_description_ja">
              {t("common.optional")}: {t("resource.descriptionJaLabel")}
            </label>
            <textarea id="resource_description_ja" className="resource-form__text" value={ja.description ?? ""} onChange={(e) => setJa("description", e.target.value)} maxLength={RESOURCE_DESCRIPTION_MAX} />
          </div>
          <div className="form-group">
            <label htmlFor="resource_environment_ja">
              {t("common.optional")}: {t("resource.environmentJaLabel")}
            </label>
            <textarea id="resource_environment_ja" className="resource-form__text" value={ja.environment ?? ""} onChange={(e) => setJa("environment", e.target.value)} maxLength={RESOURCE_ENVIRONMENT_MAX} />
          </div>
        </fieldset>

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting || !ready}>
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

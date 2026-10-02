import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CATEGORY_ORDER, createInvitationSchema, type Category, type CreateInvitationInput, type Role, type TeamMember } from "@scl/shared";
import { Modal } from "./Modal";
import { ApiError } from "../lib/api";
import { useT } from "../i18n/LocaleContext";
import { CATEGORY_LABEL_KEY } from "../i18n/labels";

type LinkMode = "existing" | "new" | "none";

interface InviteValues {
  email: string;
  role: Role;
  linkMode: LinkMode;
  teamMemberId: string;
  name: string;
  initials: string;
  memberRole: string;
  category: Category;
}

interface InviteResearcherModalProps {
  open: boolean;
  /** Team members with no account yet — the only ones the "link existing" mode can offer. */
  unlinkedMembers: TeamMember[];
  onClose: () => void;
  /** Resolves with the one-time invitation link once the server returns it — the caller shows it
   * to the admin (see AdminPeoplePage's InvitationLinkModal); nothing here ever stores it. */
  onCreate: (payload: CreateInvitationInput) => Promise<string>;
}

function emptyValues(unlinkedMembers: TeamMember[]): InviteValues {
  return {
    email: "",
    role: "MEMBER",
    linkMode: "existing",
    teamMemberId: unlinkedMembers[0]?.id ?? "",
    name: "",
    initials: "",
    memberRole: "",
    category: "BSC",
  };
}

/**
 * Researcher onboarding (PHASE 1): replaces the old "create login with a temp password" dialog.
 * This form never collects a password — the admin chooses an email, a role and (optionally) a
 * team-profile link, then POST /api/invitations returns a one-time setup link for the admin to
 * copy and send privately. The researcher chooses their own password at that link (see
 * pages/InvitePage.tsx); the admin never sees it.
 */
export function InviteResearcherModal({ open, unlinkedMembers, onClose, onCreate }: InviteResearcherModalProps) {
  const t = useT();
  const [values, setValues] = useState<InviteValues>(() => emptyValues(unlinkedMembers));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(emptyValues(unlinkedMembers));
      setError(null);
    }
    // Only reset when the dialog opens; the member list is read fresh at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function set<K extends keyof InviteValues>(key: K, value: InviteValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const payload: Record<string, unknown> = {
      email: values.email,
      role: values.role,
    };
    if (values.linkMode === "existing") {
      if (!values.teamMemberId) {
        setError(t("admin.createLogin.chooseOrCreate"));
        return;
      }
      payload.teamMemberId = values.teamMemberId;
    } else if (values.linkMode === "new") {
      payload.name = values.name;
      payload.initials = values.initials;
      payload.memberRole = values.memberRole;
      payload.category = values.category;
    }

    const parsed = createInvitationSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.checkForm"));
      return;
    }

    setSubmitting(true);
    try {
      await onCreate(parsed.data);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={t("admin.invite.title")}>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <p className="form-hint">{t("admin.invite.intro")}</p>
        <div className="form-group">
          <label htmlFor="inv_email">{t("admin.createLogin.email")}</label>
          <input id="inv_email" type="email" autoComplete="off" value={values.email} onChange={(e) => set("email", e.target.value)} required />
        </div>

        <div className="form-group">
          <label htmlFor="inv_role">{t("admin.createLogin.accountRole")}</label>
          <select id="inv_role" value={values.role} onChange={(e) => set("role", e.target.value as Role)}>
            <option value="MEMBER">{t("admin.createLogin.roleMember")}</option>
            <option value="LAB_MANAGER">{t("admin.createLogin.roleLabManager")}</option>
            <option value="ADMIN">{t("admin.createLogin.roleAdmin")}</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="inv_linkMode">{t("admin.createLogin.linkToProfile")}</label>
          <select id="inv_linkMode" value={values.linkMode} onChange={(e) => set("linkMode", e.target.value as LinkMode)}>
            <option value="existing">{t("admin.createLogin.linkExisting")}</option>
            <option value="new">{t("admin.createLogin.linkNew")}</option>
            <option value="none">{t("admin.createLogin.linkNone")}</option>
          </select>
        </div>

        {values.linkMode === "existing" && (
          <div className="form-group">
            <label htmlFor="inv_teamMemberId">{t("admin.createLogin.teamMember")}</label>
            <select
              id="inv_teamMemberId"
              value={values.teamMemberId}
              onChange={(e) => set("teamMemberId", e.target.value)}
              disabled={unlinkedMembers.length === 0}
            >
              {unlinkedMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {unlinkedMembers.length === 0 && <p className="form-hint">{t("admin.createLogin.noUnlinkedHint")}</p>}
          </div>
        )}

        {values.linkMode === "new" && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="inv_name">{t("admin.createLogin.fullName")}</label>
                <input id="inv_name" value={values.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="inv_initials">{t("admin.createLogin.initials")}</label>
                <input id="inv_initials" value={values.initials} onChange={(e) => set("initials", e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="inv_memberRole">{t("admin.createLogin.memberRole")}</label>
                <input id="inv_memberRole" value={values.memberRole} onChange={(e) => set("memberRole", e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="inv_category">{t("admin.createLogin.category")}</label>
                <select id="inv_category" value={values.category} onChange={(e) => set("category", e.target.value as Category)}>
                  {CATEGORY_ORDER.map((cat) => (
                    <option key={cat} value={cat}>
                      {t(CATEGORY_LABEL_KEY[cat])}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting}>
            {submitting ? t("admin.invite.creating") : t("admin.invite.generateLink")}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

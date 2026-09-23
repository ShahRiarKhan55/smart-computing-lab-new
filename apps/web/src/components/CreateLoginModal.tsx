import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CATEGORY_ORDER, MIN_PASSWORD_LENGTH, createUserSchema, type Category, type CreateUserInput, type Role, type TeamMember } from "@scl/shared";
import { Modal } from "./Modal";
import { ApiError } from "../lib/api";
import { useT } from "../i18n/LocaleContext";
import { CATEGORY_LABEL_KEY } from "../i18n/labels";

type LinkMode = "existing" | "new" | "none";

interface CreateLoginValues {
  email: string;
  password: string;
  role: Role;
  linkMode: LinkMode;
  teamMemberId: string;
  name: string;
  initials: string;
  memberRole: string;
  category: Category;
}

interface CreateLoginModalProps {
  open: boolean;
  /** Team members with no account yet — the only ones the "link existing" mode can offer. */
  unlinkedMembers: TeamMember[];
  onClose: () => void;
  onCreate: (payload: CreateUserInput) => Promise<void>;
}

function emptyValues(unlinkedMembers: TeamMember[]): CreateLoginValues {
  return {
    email: "",
    password: "",
    role: "MEMBER",
    linkMode: "existing",
    teamMemberId: unlinkedMembers[0]?.id ?? "",
    name: "",
    initials: "",
    memberRole: "",
    category: "BSC",
  };
}

/** Reference admin.html "Create login for a member" dialog: link existing / create new profile / no profile. */
export function CreateLoginModal({ open, unlinkedMembers, onClose, onCreate }: CreateLoginModalProps) {
  const t = useT();
  const [values, setValues] = useState<CreateLoginValues>(() => emptyValues(unlinkedMembers));
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

  function set<K extends keyof CreateLoginValues>(key: K, value: CreateLoginValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const payload: Record<string, unknown> = {
      email: values.email,
      password: values.password,
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

    const parsed = createUserSchema.safeParse(payload);
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
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={t("admin.createLogin.title")}>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="c_email">{t("admin.createLogin.email")}</label>
            <input
              id="c_email"
              type="email"
              autoComplete="off"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="c_password">{t("admin.createLogin.tempPassword")}</label>
            <input
              id="c_password"
              type="text"
              autoComplete="off"
              value={values.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder={t("admin.createLogin.tempPasswordHint", { min: MIN_PASSWORD_LENGTH })}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="c_role">{t("admin.createLogin.accountRole")}</label>
          <select id="c_role" value={values.role} onChange={(e) => set("role", e.target.value as Role)}>
            <option value="MEMBER">{t("admin.createLogin.roleMember")}</option>
            <option value="LAB_MANAGER">{t("admin.createLogin.roleLabManager")}</option>
            <option value="ADMIN">{t("admin.createLogin.roleAdmin")}</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="c_linkMode">{t("admin.createLogin.linkToProfile")}</label>
          <select id="c_linkMode" value={values.linkMode} onChange={(e) => set("linkMode", e.target.value as LinkMode)}>
            <option value="existing">{t("admin.createLogin.linkExisting")}</option>
            <option value="new">{t("admin.createLogin.linkNew")}</option>
            <option value="none">{t("admin.createLogin.linkNone")}</option>
          </select>
        </div>

        {values.linkMode === "existing" && (
          <div className="form-group">
            <label htmlFor="c_teamMemberId">{t("admin.createLogin.teamMember")}</label>
            <select
              id="c_teamMemberId"
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
                <label htmlFor="c_name">{t("admin.createLogin.fullName")}</label>
                <input id="c_name" value={values.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="c_initials">{t("admin.createLogin.initials")}</label>
                <input id="c_initials" value={values.initials} onChange={(e) => set("initials", e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="c_memberRole">{t("admin.createLogin.memberRole")}</label>
                <input id="c_memberRole" value={values.memberRole} onChange={(e) => set("memberRole", e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="c_category">{t("admin.createLogin.category")}</label>
                <select
                  id="c_category"
                  value={values.category}
                  onChange={(e) => set("category", e.target.value as Category)}
                >
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
            {submitting ? t("admin.createLogin.creating") : t("admin.createLogin.createAccount")}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

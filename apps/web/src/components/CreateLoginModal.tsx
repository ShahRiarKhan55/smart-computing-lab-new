import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  MIN_PASSWORD_LENGTH,
  createUserSchema,
  type Category,
  type CreateUserInput,
  type Role,
  type TeamMember,
} from "@scl/shared";
import { Modal } from "./Modal";
import { ApiError } from "../lib/api";

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
        setError('Choose a team member to link, or pick "Create a brand new team member profile" instead.');
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
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    setSubmitting(true);
    try {
      await onCreate(parsed.data);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title="Create login for a member">
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="c_email">Email</label>
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
            <label htmlFor="c_password">Temporary password</label>
            <input
              id="c_password"
              type="text"
              autoComplete="off"
              value={values.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="c_role">Account role</label>
          <select id="c_role" value={values.role} onChange={(e) => set("role", e.target.value as Role)}>
            <option value="MEMBER">Member (edits own profile; adds publications, news, research)</option>
            <option value="LAB_MANAGER">Lab manager (manages content, projects and groups; no accounts)</option>
            <option value="ADMIN">Admin (everything, including accounts and roles)</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="c_linkMode">Link to team profile</label>
          <select id="c_linkMode" value={values.linkMode} onChange={(e) => set("linkMode", e.target.value as LinkMode)}>
            <option value="existing">Link to an existing (unlinked) team member</option>
            <option value="new">Create a brand new team member profile</option>
            <option value="none">No team profile (admin-only account)</option>
          </select>
        </div>

        {values.linkMode === "existing" && (
          <div className="form-group">
            <label htmlFor="c_teamMemberId">Team member</label>
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
            {unlinkedMembers.length === 0 && (
              <p className="form-hint">
                No unlinked team members available — try "Create a brand new team member profile" instead.
              </p>
            )}
          </div>
        )}

        {values.linkMode === "new" && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="c_name">Full name</label>
                <input id="c_name" value={values.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="c_initials">Initials</label>
                <input id="c_initials" value={values.initials} onChange={(e) => set("initials", e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="c_memberRole">Role / title</label>
                <input id="c_memberRole" value={values.memberRole} onChange={(e) => set("memberRole", e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="c_category">Category</label>
                <select
                  id="c_category"
                  value={values.category}
                  onChange={(e) => set("category", e.target.value as Category)}
                >
                  {CATEGORY_ORDER.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create account"}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

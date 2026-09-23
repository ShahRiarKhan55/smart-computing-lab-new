import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { CATEGORY_LABELS, updateOwnProfileSchema, type TeamMember } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";

interface ProfileValues {
  name: string;
  initials: string;
  role: string;
  department: string;
  bio: string;
  photoUrl: string;
}

type FieldErrors = Partial<Record<keyof ProfileValues, string>>;

function toValues(member: TeamMember): ProfileValues {
  return {
    name: member.name,
    initials: member.initials,
    role: member.role,
    department: member.department,
    bio: member.bio,
    photoUrl: member.photoUrl,
  };
}

export function ProfilePage() {
  const { user } = useAuth();
  const { data: member, loading, error, status, reload } = useApiResource<TeamMember>("/profile");

  return (
    <>
      <PageHeader
        eyebrow={`Signed in as ${user?.email ?? ""}`}
        title="My Profile"
        description="Update how you appear on the public Team page."
      />
      <div className="container">
        {loading && !member && <LoadingState label="Loading your profile…" variant="text" />}
        {/* 404 just means no team profile is linked yet — a status, not a failure. */}
        {status === 404 && <EmptyState title={error ?? "No team profile is linked to this account yet."} />}
        {error && status !== 404 && <ErrorState message={error} onRetry={reload} />}
        {member && <ProfileForm initial={member} />}
      </div>
    </>
  );
}

function ProfileForm({ initial }: { initial: TeamMember }) {
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState<ProfileValues>(() => toValues(initial));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const savedValues = toValues(saved);
  const dirty = (Object.keys(values) as (keyof ProfileValues)[]).some((k) => values[k] !== savedValues[k]);

  function change(key: keyof ProfileValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    setSuccess(false);
  }

  function reset() {
    setValues(savedValues);
    setFieldErrors({});
    setFormError(null);
    setSuccess(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccess(false);

    const parsed = updateOwnProfileSchema.safeParse(values);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ProfileValues | undefined;
        if (key === undefined) setFormError(issue.message);
        else if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const updated = await apiFetch<TeamMember>("/profile", { method: "PUT", body: JSON.stringify(parsed.data) });
      // Show exactly what the server stored (it trims), without a second fetch.
      setSaved(updated);
      setValues(toValues(updated));
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.status === 401 ? "Your session has expired. Please log in again." : err.message);
      } else {
        setFormError("Could not reach the server. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  function field(key: keyof ProfileValues) {
    const message = fieldErrors[key];
    return {
      id: `f_${key}`,
      value: values[key],
      onChange: (e: { target: { value: string } }) => change(key, e.target.value),
      "aria-invalid": message ? (true as const) : undefined,
      "aria-describedby": message ? `f_${key}_error` : undefined,
    };
  }

  function fieldError(key: keyof ProfileValues) {
    const message = fieldErrors[key];
    return message ? (
      <p className="form-field-error" id={`f_${key}_error`}>
        {message}
      </p>
    ) : null;
  }

  return (
    <div className="detail-layout detail-layout--aside-first">
      <div>
        {success && (
          <div className="form-success" role="status">
            <Icon name="check" size={16} /> Profile updated.
          </div>
        )}
        {formError && <ErrorState message={formError} />}

        <form className="form-card" onSubmit={handleSubmit} noValidate aria-label="Edit your profile">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="f_name">Full name</label>
              <input {...field("name")} maxLength={120} required autoComplete="name" />
              {fieldError("name")}
            </div>
            <div className="form-group">
              <label htmlFor="f_initials">Initials (shown on avatar)</label>
              <input {...field("initials")} maxLength={10} required />
              {fieldError("initials")}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="f_role">Role / title</label>
              <input {...field("role")} maxLength={120} required autoComplete="organization-title" />
              {fieldError("role")}
            </div>
            <div className="form-group">
              <label htmlFor="f_department">Department / focus area</label>
              <input {...field("department")} maxLength={200} />
              {fieldError("department")}
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="f_bio">Short bio</label>
            <textarea {...field("bio")} maxLength={2000} />
            {fieldError("bio")}
          </div>
          <div className="form-group">
            <label htmlFor="f_photoUrl">Photo URL (optional — leave blank to show initials)</label>
            <input {...field("photoUrl")} placeholder="https://..." inputMode="url" />
            {fieldError("photoUrl")}
          </div>

          <div className="form-actions">
            <button className="btn btn--primary form-submit" type="submit" disabled={saving || !dirty} aria-busy={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button className="btn btn--secondary" type="button" onClick={reset} disabled={saving || !dirty}>
              Reset
            </button>
          </div>
        </form>
      </div>

      <aside className="detail-layout__aside" aria-label="Profile preview">
        <section className="panel profile-summary">
          <Avatar size="xl" initials={values.initials || saved.initials} photoUrl={saved.photoUrl} />
          <div>
            <p className="profile-summary__role">{values.name || saved.name}</p>
            <p className="profile-summary__dept">{values.role}</p>
          </div>
          <p className="card-note">Category: {CATEGORY_LABELS[saved.category]} (changed only by the admin)</p>
          <Link to={`/team/${saved.id}`} className="btn btn--secondary btn--sm">
            View your public profile <Icon name="arrow-right" size={14} />
          </Link>
        </section>
      </aside>
    </div>
  );
}

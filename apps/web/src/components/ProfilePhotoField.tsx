import { useEffect, useRef, useState } from "react";
import { DEFAULT_PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_MIME_TYPES, type TeamMember } from "@scl/shared";
import { Avatar } from "./Avatar";
import { apiFetch, apiUpload } from "../lib/api";
import { uploadErrorMessage } from "../lib/uploadErrors";
import { formatBytes } from "../lib/format";
import { uploadErrorMessage } from "../lib/uploadErrors";
import { useLocale } from "../i18n/LocaleContext";

interface ProfilePhotoFieldProps {
  /** The profile to attach the photo to. Absent = a profile that is not saved yet (no upload possible). */
  memberId?: string;
  initials: string;
  photoUrl: string;
  /** Called with the new `photoUrl` after a successful upload/removal, so the surrounding form stays in step with the server. */
  onChange: (photoUrl: string) => void;
}

const ACCEPT = PROFILE_PHOTO_MIME_TYPES.join(",");

/**
 * Pick a photo from the computer, preview it, then upload it. The server is the authority (magic
 * bytes, size, pixel dimensions, who may upload); the checks here are only fast feedback. Nothing is
 * changed until the upload succeeds, so a failure never loses the photo currently in use.
 */
export function ProfilePhotoField({ memberId, initials, photoUrl, onChange }: ProfilePhotoFieldProps) {
  const { locale, t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const maxLabel = formatBytes(DEFAULT_PROFILE_PHOTO_MAX_BYTES, locale);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | null) {
    setError(null);
    setNotice(null);
    if (f && !(PROFILE_PHOTO_MIME_TYPES as readonly string[]).includes(f.type)) {
      setFile(null);
      setError(t("photo.unsupported"));
      return;
    }
    if (f && f.size > DEFAULT_PROFILE_PHOTO_MAX_BYTES) {
      setFile(null);
      setError(t("photo.tooLarge", { max: maxLabel }));
      return;
    }
    setFile(f);
  }

  async function upload() {
    if (!file || !memberId) return;
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const updated = await apiUpload<TeamMember>(`/team/${memberId}/photo`, form);
      onChange(updated.photoUrl);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setNotice(t("photo.uploaded"));
    } catch (err) {
      setError(uploadErrorMessage(err, t, maxLabel));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!memberId || !window.confirm(t("photo.removeConfirm"))) return;
    setBusy("remove");
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<TeamMember>(`/team/${memberId}/photo`, { method: "DELETE" });
      onChange(updated.photoUrl);
      setNotice(t("photo.removed"));
    } catch (err) {
      setError(uploadErrorMessage(err, t, maxLabel));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="photo-field">
      {memberId ? (
        <label className="photo-field__label" id="photo_field_label" htmlFor="photo_file">
          {t("photo.label")}
        </label>
      ) : (
        <p className="photo-field__label" id="photo_field_label">
          {t("photo.label")}
        </p>
      )}
      <div className="photo-field__row">
        <Avatar size="lg" initials={initials} photoUrl={preview ?? (photoUrl || undefined)} />
        <div className="photo-field__controls">
          {memberId ? (
            <>
              <input
                ref={inputRef}
                id="photo_file"
                type="file"
                accept={ACCEPT}
                aria-labelledby="photo_field_label"
                aria-describedby="photo_hint"
                disabled={busy !== null}
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              <p className="form-hint" id="photo_hint">
                {t("photo.hint", { max: maxLabel })}
              </p>
              {file && (
                <p className="form-hint" aria-live="polite">
                  {t("photo.selected", { name: file.name, size: formatBytes(file.size, locale) })}
                </p>
              )}
              <div className="photo-field__actions">
                <button type="button" className="btn btn--primary btn--sm" onClick={upload} disabled={!file || busy !== null} aria-busy={busy === "upload"}>
                  {busy === "upload" ? t("photo.uploading") : t("photo.upload")}
                </button>
                {photoUrl && (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={remove} disabled={busy !== null} aria-busy={busy === "remove"}>
                    {t("photo.remove")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="form-hint">{t("photo.saveFirst")}</p>
          )}
        </div>
      </div>
      <div aria-live="polite">
        {notice && <p className="form-success photo-field__note">{notice}</p>}
        {error && (
          <p className="form-error photo-field__note" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

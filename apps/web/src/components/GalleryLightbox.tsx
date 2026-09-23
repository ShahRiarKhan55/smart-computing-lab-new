import { useEffect } from "react";
import { Link } from "react-router-dom";
import type { GalleryItem } from "@scl/shared";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { VisibilityBadge } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";
import { GALLERY_CATEGORY_LABEL_KEY } from "../i18n/labels";

interface GalleryLightboxProps {
  item: GalleryItem | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

/**
 * Accessible image viewer built on the shared `Modal` (real dialog, focus trap, Escape closes,
 * focus returns to the trigger — Phase 13 §"lightbox"). Adds Left/Right arrow-key navigation on
 * top of Modal's own Escape/Tab handling; Previous/Next are only rendered when a handler is
 * given (the gallery only offers them within the current loaded page).
 */
export function GalleryLightbox({ item, onClose, onPrev, onNext }: GalleryLightboxProps) {
  const t = useT();
  useEffect(() => {
    if (!item) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [item, onPrev, onNext]);

  if (!item) return null;

  return (
    <Modal open={Boolean(item)} onClose={onClose} title={item.caption || t("gallery.photoFallback")}>
      <div className="lightbox">
        <img className="lightbox__img" src={item.file.url} alt={item.caption || t("gallery.imageAlt")} />
        <div className="lightbox__meta">
          <span className="badge">{t(GALLERY_CATEGORY_LABEL_KEY[item.category])}</span>
          <VisibilityBadge visibility={item.visibility} />
          {item.project && (
            <Link to={`/projects/${item.project.id}`} className="link-inline">
              {item.project.title}
            </Link>
          )}
        </div>
        {(onPrev || onNext) && (
          <div className="lightbox__nav">
            <button type="button" className="btn btn--secondary btn--sm" onClick={onPrev} disabled={!onPrev} aria-label={t("gallery.previousPhotoAria")}>
              <Icon name="arrow-left" size={14} /> {t("common.previous")}
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={onNext} disabled={!onNext} aria-label={t("gallery.nextPhotoAria")}>
              {t("common.next")} <Icon name="arrow-right" size={14} />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

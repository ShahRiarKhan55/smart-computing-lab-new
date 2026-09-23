import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GALLERY_CATEGORIES, GALLERY_CATEGORY_LABELS, type GalleryCategory, type GalleryItem, type GalleryListResponse, type ProjectSummary } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { SectionHeader } from "../components/SectionHeader";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { GalleryCard } from "../components/GalleryCard";
import { GalleryLightbox } from "../components/GalleryLightbox";
import { GalleryUploadModal } from "../components/GalleryUploadModal";
import { GalleryFormModal, type GalleryEditFields } from "../components/GalleryFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";

const LIMIT = 24;
type CategoryFilter = "ALL" | GalleryCategory;

export function GalleryPage() {
  const policy = usePolicy();
  const [searchParams] = useSearchParams();
  // A project detail page links here as "View all" (Phase 13 §"project page integration"); the
  // filter is otherwise never shown in the UI, so it never becomes a second, URL-driven filter
  // control to keep in sync with the category chips below.
  const projectFilter = searchParams.get("project");
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [page, setPage] = useState(1);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState<GalleryItem | null>(null);
  const [deleting, setDeleting] = useState<GalleryItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  if (category !== "ALL") query.set("category", category);
  if (projectFilter) query.set("project", projectFilter);
  const { data, loading, error, reload } = useApiResource<GalleryListResponse>(`/gallery?${query.toString()}`);
  const { data: projects } = useApiResource<ProjectSummary[]>("/projects");
  const projectOptions = (projects ?? []).map((p) => ({ id: p.id, title: p.title }));

  function changeCategory(next: CategoryFilter) {
    setCategory(next);
    setPage(1);
  }

  const items = data?.items ?? [];
  const lightboxItem = lightboxIndex !== null ? (items[lightboxIndex] ?? null) : null;

  async function saveEdit(id: string, fields: GalleryEditFields) {
    await apiFetch(`/gallery/${id}`, { method: "PUT", body: JSON.stringify(fields) });
    reload();
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await apiFetch(`/gallery/${deleting.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete this photo.");
      throw err;
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="Lab Gallery"
        description="Photos from projects, events and everyday life in the lab."
        actions={
          policy.canCreateGalleryItem && (
            <button className="btn btn--primary" type="button" onClick={() => setShowUpload(true)}>
              <Icon name="upload" size={16} /> Add photo
            </button>
          )
        }
      />

      <div className="container">
        {actionError && <ErrorState message={actionError} onRetry={() => setActionError(null)} />}

        <SectionHeader
          compact
          title="Browse"
          action={
            <div className="chips" role="group" aria-label="Filter by category">
              <button type="button" className={`chip${category === "ALL" ? " active" : ""}`} onClick={() => changeCategory("ALL")} aria-pressed={category === "ALL"}>
                All
              </button>
              {GALLERY_CATEGORIES.map((c) => (
                <button key={c} type="button" className={`chip${category === c ? " active" : ""}`} onClick={() => changeCategory(c)} aria-pressed={category === c}>
                  {GALLERY_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          }
        />

        {loading && !data && <LoadingState label="Loading gallery…" variant="cards" count={8} />}
        {error && !data && <ErrorState message={error} onRetry={reload} />}

        {data && items.length === 0 && (
          <EmptyState title="No photos here yet.">
            {policy.canCreateGalleryItem ? "Be the first to add one." : "Check back later."}
          </EmptyState>
        )}

        {items.length > 0 && (
          <>
            <div className="gallery-grid">
              {items.map((item, i) => (
                <GalleryCard
                  key={item.id}
                  item={item}
                  onOpen={() => setLightboxIndex(i)}
                  onEdit={() => setEditing(item)}
                  onDelete={() => setDeleting(item)}
                />
              ))}
            </div>

            {data && data.pagination.totalPages > 1 && (
              <nav className="search-pager" aria-label="Gallery pages">
                {page > 1 ? (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPage((p) => p - 1)}>
                    <Icon name="arrow-left" size={14} /> Previous
                  </button>
                ) : (
                  <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
                    <Icon name="arrow-left" size={14} /> Previous
                  </span>
                )}
                <span className="search-pager__pos">
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </span>
                {page < data.pagination.totalPages ? (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPage((p) => p + 1)}>
                    Next <Icon name="arrow-right" size={14} />
                  </button>
                ) : (
                  <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
                    Next <Icon name="arrow-right" size={14} />
                  </span>
                )}
              </nav>
            )}
          </>
        )}
      </div>

      <GalleryLightbox
        item={lightboxItem}
        onClose={() => setLightboxIndex(null)}
        onPrev={lightboxIndex !== null && lightboxIndex > 0 ? () => setLightboxIndex((i) => (i !== null ? i - 1 : i)) : undefined}
        onNext={lightboxIndex !== null && lightboxIndex < items.length - 1 ? () => setLightboxIndex((i) => (i !== null ? i + 1 : i)) : undefined}
      />

      <GalleryUploadModal
        open={showUpload}
        projects={projectOptions}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setShowUpload(false)}
        onUploaded={() => {
          setPage(1);
          reload();
        }}
      />

      <GalleryFormModal
        open={editing !== null}
        item={editing}
        projects={projectOptions}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setEditing(null)}
        onSubmit={(fields) => saveEdit(editing!.id, fields)}
      />

      <ConfirmDeleteModal
        open={deleting !== null}
        title="Delete photo"
        message={`Delete "${deleting?.caption || "this photo"}"? This cannot be undone.`}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}

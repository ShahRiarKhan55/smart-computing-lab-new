import { useEffect, useState } from "react";
import type { TranslatableEntityType, TranslationsResponse } from "@scl/shared";
import { apiFetch } from "../lib/api";

/**
 * Fetches and edits an entity's Japanese field overrides for a form's "Japanese translation"
 * section (Phase 14 — the minimum practical editing UI: one extra field per translatable column,
 * inside the existing content form; see docs/architecture/phase14-localization.md §"translation
 * editing"). Only fetches while editing an existing entity: a brand-new one has no id yet, so a
 * translation has nowhere to attach until after the first save.
 */
export function useEntityTranslations(entityType: TranslatableEntityType, entityId: string | undefined, open: boolean) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !entityId) {
      setValues({});
      return;
    }
    let cancelled = false;
    apiFetch<TranslationsResponse>(`/translations/${entityType}/${entityId}`)
      .then((res) => {
        if (cancelled) return;
        const filled: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.ja)) filled[key] = value ?? "";
        setValues(filled);
      })
      .catch(() => {
        // No override yet, or the fetch failed: an empty section is the safe default (nothing to
        // clear, nothing invented) — the entity's own PUT is still the source of truth on save.
        if (!cancelled) setValues({});
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, open]);

  function setField(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  return { values, setField };
}

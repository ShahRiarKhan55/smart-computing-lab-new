import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export interface KnowledgeOptions {
  projects: { id: string; label: string }[];
  areas: { id: string; label: string }[];
  groups: { id: string; label: string }[];
  researchers: { id: string; label: string }[];
}

/**
 * The picklists behind the knowledge filters and the document form: every project, research area,
 * group and researcher THIS viewer may see. They come from the ordinary list endpoints, which already
 * apply visibility (a guest is never offered a LAB_ONLY project), so nothing here decides who sees what.
 * Loaded once when `enabled` first becomes true; a failed list is simply empty (the filter/link is optional).
 */
export function useKnowledgeOptions(enabled: boolean): KnowledgeOptions | null {
  const [options, setOptions] = useState<KnowledgeOptions | null>(null);

  useEffect(() => {
    if (!enabled || options) return;
    let cancelled = false;
    const load = async <T,>(path: string, label: (row: T) => string): Promise<{ id: string; label: string }[]> => {
      try {
        const rows = await apiFetch<(T & { id: string })[]>(path);
        return rows.map((r) => ({ id: r.id, label: label(r) }));
      } catch {
        return [];
      }
    };
    Promise.all([
      load<{ title: string }>("/projects", (r) => r.title),
      load<{ title: string }>("/research", (r) => r.title),
      load<{ name: string }>("/groups", (r) => r.name),
      load<{ name: string }>("/team", (r) => r.name),
    ]).then(([projects, areas, groups, researchers]) => {
      if (!cancelled) setOptions({ projects, areas, groups, researchers });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return options;
}

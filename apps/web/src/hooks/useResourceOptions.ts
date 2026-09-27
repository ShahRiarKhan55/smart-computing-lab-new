import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import type { KnowledgeOptions } from "./useKnowledgeOptions";

export interface ResourceOptions extends KnowledgeOptions {
  docs: { id: string; label: string }[];
  publications: { id: string; label: string }[];
  events: { id: string; label: string }[];
}

/**
 * The picklists behind the resource filters and form: every project, research area, group, researcher,
 * documentation page, publication and event THIS viewer may see. They come from the ordinary list endpoints,
 * which already apply visibility (a guest is never offered a LAB_ONLY project), so nothing here decides who
 * sees what. Loaded once when `enabled` first becomes true; a failed list is simply empty (every link is optional).
 * The document list is the newest 50 (the list endpoint's page); an already-linked one is added by the form.
 */
export function useResourceOptions(enabled: boolean): ResourceOptions | null {
  const [options, setOptions] = useState<ResourceOptions | null>(null);

  useEffect(() => {
    if (!enabled || options) return;
    let cancelled = false;
    const load = async <T,>(path: string, pick: (body: unknown) => (T & { id: string })[], label: (row: T) => string): Promise<{ id: string; label: string }[]> => {
      try {
        const rows = pick(await apiFetch<unknown>(path));
        return rows.map((r) => ({ id: r.id, label: label(r) }));
      } catch {
        return [];
      }
    };
    const list = <T,>(body: unknown) => body as (T & { id: string })[];
    const items = <T,>(body: unknown) => (body as { items: (T & { id: string })[] }).items;
    Promise.all([
      load<{ title: string }>("/projects", list, (r) => r.title),
      load<{ title: string }>("/research", list, (r) => r.title),
      load<{ name: string }>("/groups", list, (r) => r.name),
      load<{ name: string }>("/team", list, (r) => r.name),
      load<{ title: string }>("/knowledge?limit=50", items, (r) => r.title),
      load<{ title: string; year: number }>("/publications", list, (r) => `${r.title} (${r.year})`),
      load<{ title: string }>("/events?scope=all&limit=200", list, (r) => r.title),
    ]).then(([projects, areas, groups, researchers, docs, publications, events]) => {
      if (!cancelled) setOptions({ projects, areas, groups, researchers, docs, publications, events });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return options;
}

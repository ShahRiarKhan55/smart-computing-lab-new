import { useEffect } from "react";

const SITE = "Smart Computing Lab";

/** Names the page in the browser tab and history ("Projects · Smart Computing Lab"); the SPA has one static <title> otherwise. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${SITE}`;
    return () => {
      document.title = SITE;
    };
  }, [title]);
}

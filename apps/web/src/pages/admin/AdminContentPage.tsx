import type { AdminContentType } from "@scl/shared";
import { AdminContentBrowser } from "../../components/admin/AdminContentBrowser";

/** Events have their own section; every other content type is browsed here. */
const TYPES: AdminContentType[] = ["research-area", "project", "group", "publication", "news", "knowledge", "resource", "team-member"];

export function AdminContentPage() {
  return <AdminContentBrowser types={TYPES} />;
}

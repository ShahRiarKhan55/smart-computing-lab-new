import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GroupDetail, GroupSummary } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { GroupCard } from "../components/GroupCard";
import { GroupFormModal } from "../components/GroupFormModal";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { useT } from "../i18n/LocaleContext";

export function GroupsPage() {
  const t = useT();
  const policy = usePolicy();
  const navigate = useNavigate();
  const { data: groups, loading, error, reload } = useApiResource<GroupSummary[]>("/groups");
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageHeader eyebrow={t("nav.people")} title={t("groups.pageTitle")} description={t("groups.pageDescription")} />

      <div className="container">
        {policy.canCreateGroup && (
          <AdminBar
            text={t("groups.manageCreateSuffix", { role: policy.roleLabel })}
            actionLabel={`+ ${t("groups.newGroup")}`}
            onAction={() => setCreateOpen(true)}
          />
        )}

        {loading && !groups && <LoadingState label={t("groups.loadingGroups")} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {groups && groups.length > 0 && <h2 className="sr-only">{t("groups.headingSr")}</h2>}
        {groups &&
          (groups.length === 0 ? (
            <EmptyState title={policy.user ? t("groups.empty") : t("groups.emptyGuest")}>
              {policy.user ? t("groups.emptyHintUser") : t("groups.emptyHintGuest")}
            </EmptyState>
          ) : (
            <div className="grid">
              {groups.map((g) => (
                <GroupCard key={g.id} group={g} />
              ))}
            </div>
          ))}
      </div>

      <GroupFormModal
        open={createOpen}
        title={t("groups.newTitle")}
        initial={null}
        canManageSettings={policy.isManager}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (payload) => {
          const created = await apiFetch<GroupDetail>("/groups", { method: "POST", body: JSON.stringify(payload) });
          navigate(`/groups/${created.id}`);
        }}
      />
    </>
  );
}

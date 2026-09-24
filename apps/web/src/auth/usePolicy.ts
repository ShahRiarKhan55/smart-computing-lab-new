import { useMemo } from "react";
import type { Actor, TranslationKey } from "@scl/shared";
import {
  canAccessAdmin,
  canBulkChangeVisibility,
  canChangeVisibility,
  canCommentForum,
  canCreateForumTopic,
  canCreateGalleryItem,
  canCreateGroup,
  canCreateProject,
  canCreateTeamMember,
  canDeleteContent,
  canDeleteTeamMember,
  canEditProfileView,
  canLinkAccounts,
  canManageForumCategories,
  canManageTeamPlacement,
  canManageTranslations,
  canManageUsers,
  canModerate,
  canReactForum,
  canViewAccountAudit,
  canViewAuditLog,
  isAdmin,
  isLabManager,
  isManager,
} from "@scl/shared";
import { useAuth } from "./AuthContext";
import { useT } from "../i18n/LocaleContext";

/** Phase 14: role names are display-only labels, chosen deliberately per locale (never the stored
 * role VALUE, which stays ADMIN/LAB_MANAGER/MEMBER in the database and API in every locale).
 * Exported so any other admin-only UI (e.g. AdminDashboardPage's role picker) can reuse the exact
 * same mapping instead of re-deciding Japanese role terminology in a second place. */
export const ROLE_LABEL_KEY: Record<string, TranslationKey> = {
  ADMIN: "admin.role.ADMIN",
  LAB_MANAGER: "admin.role.LAB_MANAGER",
  MEMBER: "admin.role.MEMBER",
};

/**
 * What the current visitor may do, derived from the SAME pure policy functions the
 * API enforces (@scl/shared/permissions). This only decides which controls to show:
 * hiding a button is a courtesy, never protection. Every action is re-checked on the
 * server, which answers 401/403 to anything the user should not be doing.
 */
export function usePolicy() {
  const { user: sessionUser } = useAuth();
  const t = useT();
  return useMemo(() => {
    // The web tsconfig is not strict, so Zod infers every SessionUser field as optional.
    // A session user always has both, so narrowing here is safe.
    const user = (sessionUser as Actor | null) ?? null;
    return {
      user: sessionUser,
      /** "Admin" / "Lab manager" / "Member" (empty for guests), localized — see ROLE_LABEL_KEY.
       * The role VALUE stored in the database and sent by the API is never translated. */
      roleLabel: user ? t(ROLE_LABEL_KEY[user.role] ?? "admin.role.MEMBER") : "",
      isAdmin: isAdmin(user),
      isLabManager: isLabManager(user),
      isManager: isManager(user),
      canManageUsers: canManageUsers(user),
      /** Phase 17: the admin area (managers and admins); accounts inside it stay admin-only. */
      canAccessAdmin: canAccessAdmin(user),
      canBulkChangeVisibility: canBulkChangeVisibility(user),
      canManageTranslations: canManageTranslations(user),
      canViewAuditLog: canViewAuditLog(user),
      canViewAccountAudit: canViewAccountAudit(user),
      canLinkAccounts: canLinkAccounts(user),
      canChangeVisibility: canChangeVisibility(user),
      canDeleteContent: canDeleteContent(user),
      canCreateProject: canCreateProject(user),
      canCreateGroup: canCreateGroup(user),
      canCreateTeamMember: canCreateTeamMember(user),
      canDeleteTeamMember: canDeleteTeamMember(user),
      canManageTeamPlacement: canManageTeamPlacement(user),
      canCreateForumTopic: canCreateForumTopic(user),
      canCreateGalleryItem: canCreateGalleryItem(user),
      canCommentForum: canCommentForum(user),
      canReactForum: canReactForum(user),
      canManageForumCategories: canManageForumCategories(user),
      canModerateForum: canModerate(user),
      /** Own linked profile (the server's `isOwn` flag), or any profile for a lab manager/admin. */
      canEditProfile: (isOwn: boolean | null | undefined) => canEditProfileView(user, isOwn),
    };
  }, [sessionUser, t]);
}

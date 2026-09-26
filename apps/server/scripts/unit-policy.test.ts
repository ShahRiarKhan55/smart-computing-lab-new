/**
 * Table-driven unit test of the authorization policy and the two safety helpers.
 * Pure functions only: no server, no database.   npm run test:unit -w apps/server
 *
 * Columns are always: guest, MEMBER, LAB_MANAGER, ADMIN.
 */
import * as P from "@scl/shared";
import type { Actor, Role } from "@scl/shared";
import { recordAudit } from "../src/lib/audit.js";
import { canView, visibleTo } from "../src/lib/visibility.js";
import { isOwnProfile, toTeamMember } from "../src/lib/serializers.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

const ME = "user-me";
const actors: [string, Actor | null][] = [
  ["guest", null],
  ["MEMBER", { id: ME, role: "MEMBER" }],
  ["LAB_MANAGER", { id: ME, role: "LAB_MANAGER" }],
  ["ADMIN", { id: ME, role: "ADMIN" }],
];

// [name, fn, expected for guest/MEMBER/LAB_MANAGER/ADMIN]
type Row = [string, (a: Actor | null) => boolean, [boolean, boolean, boolean, boolean]];
const F = false;
const T = true;
const rows: Row[] = [
  ["isMember (any account)", P.isMember, [F, T, T, T]],
  ["isAdmin", P.isAdmin, [F, F, F, T]],
  ["isLabManager", P.isLabManager, [F, F, T, F]],
  ["isManager (admin or lab manager)", P.isManager, [F, F, T, T]],
  ["canManageUsers", P.canManageUsers, [F, F, F, T]],
  ["canViewLabOnly", P.canViewLabOnly, [F, T, T, T]],
  ["canChangeVisibility", P.canChangeVisibility, [F, F, T, T]],
  ["canEditContent (publications/news/research)", P.canEditContent, [F, T, T, T]],
  ["canDeleteContent", P.canDeleteContent, [F, F, T, T]],
  ["canManageContent", P.canManageContent, [F, F, T, T]],
  ["canModerate", P.canModerate, [F, F, T, T]],
  ["canEditOtherProfile", P.canEditOtherProfile, [F, F, T, T]],
  ["canCreateTeamMember", P.canCreateTeamMember, [F, F, T, T]],
  ["canDeleteTeamMember", P.canDeleteTeamMember, [F, F, F, T]],
  ["canManageTeamPlacement", P.canManageTeamPlacement, [F, F, T, T]],
  ["canCreateProject", P.canCreateProject, [F, F, T, T]],
  ["canManageProjectSettings", P.canManageProjectSettings, [F, F, T, T]],
  ["canDeleteProject", P.canDeleteProject, [F, F, T, T]],
  ["canEditProject (not a lead)", (a) => P.canEditProject(a, false), [F, F, T, T]],
  ["canEditProject (is a lead)", (a) => P.canEditProject(a, true), [F, T, T, T]],
  ["canCreateGroup", P.canCreateGroup, [F, F, T, T]],
  ["canManageGroupSettings", P.canManageGroupSettings, [F, F, T, T]],
  ["canDeleteGroup", P.canDeleteGroup, [F, F, T, T]],
  ["canEditGroup (not a lead)", (a) => P.canEditGroup(a, false), [F, F, T, T]],
  ["canEditGroup (is a lead)", (a) => P.canEditGroup(a, true), [F, T, T, T]],
  // Phase 11: forum. Visibility lives on the category (canViewLabOnly, above); moderation reuses
  // canModerate. Editing TEXT is author-only (even a manager gets false for "not the author") —
  // deleting/moderating is the author or a manager.
  ["canManageForumCategories", P.canManageForumCategories, [F, F, T, T]],
  ["canCreateForumTopic", P.canCreateForumTopic, [F, T, T, T]],
  ["canCommentForum", P.canCommentForum, [F, T, T, T]],
  ["canReactForum", P.canReactForum, [F, T, T, T]],
  ["canMentionInForum", P.canMentionInForum, [F, T, T, T]],
  ["canEditForumPost (not the author)", (a) => P.canEditForumPost(a, false), [F, F, F, F]],
  ["canEditForumPost (is the author)", (a) => P.canEditForumPost(a, true), [F, T, T, T]],
  ["canDeleteForumPost (not the author)", (a) => P.canDeleteForumPost(a, false), [F, F, T, T]],
  ["canDeleteForumPost (is the author)", (a) => P.canDeleteForumPost(a, true), [F, T, T, T]],
  ["canEditForumComment (not the author)", (a) => P.canEditForumComment(a, false), [F, F, F, F]],
  ["canEditForumComment (is the author)", (a) => P.canEditForumComment(a, true), [F, T, T, T]],
  ["canDeleteForumComment (not the author)", (a) => P.canDeleteForumComment(a, false), [F, F, T, T]],
  ["canDeleteForumComment (is the author)", (a) => P.canDeleteForumComment(a, true), [F, T, T, T]],
  ["canEditOwnProfile (own profile)", (a) => P.canEditOwnProfile(a, ME), [F, T, T, T]],
  ["canEditOwnProfile (someone else's)", (a) => P.canEditOwnProfile(a, "other"), [F, F, F, F]],
  ["canEditOwnProfile (unlinked profile)", (a) => P.canEditOwnProfile(a, null), [F, F, F, F]],
  ["canEditProfile (own)", (a) => P.canEditProfile(a, ME), [F, T, T, T]],
  ["canEditProfile (someone else's)", (a) => P.canEditProfile(a, "other"), [F, F, T, T]],
  // Phase 9.1: the UI variant takes the server's isOwn flag instead of an account id.
  ["canEditProfileView (own)", (a) => P.canEditProfileView(a, true), [F, T, T, T]],
  ["canEditProfileView (someone else's)", (a) => P.canEditProfileView(a, false), [F, F, T, T]],
  ["canEditProfileView (unknown ownership)", (a) => P.canEditProfileView(a, undefined), [F, F, T, T]],
  // Phase 12: messaging + notifications. Any logged-in account, and no manager/admin extra reach
  // (the real access rules are conversation/notification membership, enforced server-side, not role).
  ["canMessage", P.canMessage, [F, T, T, T]],
  ["canViewNotifications", P.canViewNotifications, [F, T, T, T]],
  // Phase 13: files + gallery. Gallery items are OWNED content (like a forum post): any member
  // may create one, but editing/deleting needs the owner or a manager, never just any member.
  ["canUploadFile", P.canUploadFile, [F, T, T, T]],
  ["canCreateGalleryItem", P.canCreateGalleryItem, [F, T, T, T]],
  ["canEditGalleryItem (not the owner)", (a) => P.canEditGalleryItem(a, false), [F, F, T, T]],
  ["canEditGalleryItem (is the owner)", (a) => P.canEditGalleryItem(a, true), [F, T, T, T]],
  ["canDeleteGalleryItem (not the owner)", (a) => P.canDeleteGalleryItem(a, false), [F, F, T, T]],
  ["canDeleteGalleryItem (is the owner)", (a) => P.canDeleteGalleryItem(a, true), [F, T, T, T]],
  // Phase 16: events are OWNED content too (creator or manager); visibility and the project link are manager-only.
  ["canCreateEvent", P.canCreateEvent, [F, T, T, T]],
  ["canEditEvent (not the owner)", (a) => P.canEditEvent(a, false), [F, F, T, T]],
  ["canEditEvent (is the owner)", (a) => P.canEditEvent(a, true), [F, T, T, T]],
  ["canDeleteEvent (not the owner)", (a) => P.canDeleteEvent(a, false), [F, F, T, T]],
  ["canDeleteEvent (is the owner)", (a) => P.canDeleteEvent(a, true), [F, T, T, T]],
  ["canLinkEventToProject", P.canLinkEventToProject, [F, F, T, T]],
  // Phase 22: knowledge documents are OWNED content (author or manager); visibility is manager-only.
  ["canCreateKnowledge", P.canCreateKnowledge, [F, T, T, T]],
  ["canEditKnowledge (not the owner)", (a) => P.canEditKnowledge(a, false), [F, F, T, T]],
  ["canEditKnowledge (is the owner)", (a) => P.canEditKnowledge(a, true), [F, T, T, T]],
  ["canDeleteKnowledge (not the owner)", (a) => P.canDeleteKnowledge(a, false), [F, F, T, T]],
  ["canDeleteKnowledge (is the owner)", (a) => P.canDeleteKnowledge(a, true), [F, T, T, T]],
  ["canFilterKnowledgeByVisibility", P.canFilterKnowledgeByVisibility, [F, F, T, T]],
  // Phase 17: admin / CMS. Managers get the content views; accounts and account audit stay ADMIN-only.
  ["canAccessAdmin", P.canAccessAdmin, [F, F, T, T]],
  ["canBulkChangeVisibility (same rule as canChangeVisibility)", P.canBulkChangeVisibility, [F, F, T, T]],
  ["canManageTranslations", P.canManageTranslations, [F, F, T, T]],
  ["canViewAuditLog", P.canViewAuditLog, [F, F, T, T]],
  ["canViewAccountAudit (admin only)", P.canViewAccountAudit, [F, F, F, T]],
  ["canLinkAccounts (admin only, = canManageUsers)", P.canLinkAccounts, [F, F, F, T]],
];

const cell = (b: boolean) => (b ? "✔" : "·");
console.log(`${"capability".padEnd(46)} guest MEMBER LAB_MGR ADMIN`);
for (const [name, fn, expected] of rows) {
  const got = actors.map(([, a]) => fn(a));
  got.forEach((g, i) => t(`${name} for ${actors[i][0]}: expected ${expected[i]}, got ${g}`, g === expected[i]));
  console.log(`${name.padEnd(46)} ${got.map((g) => cell(g).padEnd(8)).join("")}`);
}

// Role changes: only an admin, never on themselves.
t("roleChangeError: guest denied", P.roleChangeError(null, "x") !== null);
t("roleChangeError: MEMBER denied", P.roleChangeError(actors[1][1], "x") !== null);
t("roleChangeError: LAB_MANAGER denied (cannot grant ADMIN or promote self)", P.roleChangeError(actors[2][1], "x") !== null);
t("roleChangeError: LAB_MANAGER denied on self", P.roleChangeError(actors[2][1], ME) !== null);
t("roleChangeError: ADMIN denied on self", P.roleChangeError(actors[3][1], ME) !== null);
t("roleChangeError: ADMIN allowed on another account", P.roleChangeError(actors[3][1], "someone-else") === null);

// Fail closed: an unrecognised role string grants nothing beyond "logged in".
const rogue = { id: ME, role: "SUPERUSER" as unknown as Role };
for (const [name, fn] of rows) {
  if (
    [
      "isMember (any account)",
      "canViewLabOnly",
      "canEditContent (publications/news/research)",
      "canCreateForumTopic",
      "canCommentForum",
      "canReactForum",
      "canMentionInForum",
      "canMessage",
      "canViewNotifications",
      "canUploadFile",
      "canCreateGalleryItem",
      "canCreateEvent",
      "canCreateKnowledge",
    ].includes(name)
  )
    continue;
  if (name.includes("is a lead") || name.includes("is the author") || name.includes("is the owner") || name.includes("(own") || name.includes("(unlinked")) continue;
  t(`unknown role must not pass ${name}`, fn(rogue) === false || name.includes("someone else's") && !fn(rogue));
}
t("role enum contains exactly ADMIN, LAB_MANAGER, MEMBER", P.ROLES.join() === "ADMIN,LAB_MANAGER,MEMBER");
t("roleSchema rejects unknown role", !P.roleSchema.safeParse("SUPERUSER").success);
t("roleSchema accepts LAB_MANAGER", P.roleSchema.safeParse("LAB_MANAGER").success);

// Visibility helpers fail closed.
const member: Actor = { id: "m", role: "MEMBER" };
t("guest where = PUBLIC only", JSON.stringify(visibleTo(null)) === '{"visibility":{"in":["PUBLIC"]}}');
t("account where = PUBLIC + LAB_ONLY", JSON.stringify(visibleTo(member)) === '{"visibility":{"in":["PUBLIC","LAB_ONLY"]}}');
t("canView guest PUBLIC", canView(null, "PUBLIC"));
t("canView guest LAB_ONLY denied", !canView(null, "LAB_ONLY"));
t("canView member LAB_ONLY", canView(member, "LAB_ONLY"));
for (const junk of ["public", "Public", "", "PRIVATE", "DRAFT", " PUBLIC"]) {
  t(`canView guest "${junk}" denied`, !canView(null, junk));
  t(`canView member "${junk}" denied`, !canView(member, junk));
}

// Phase 9.1: profile serializer ownership. The account id must never appear in the output.
const profileRow = { id: "tm1", userId: ME, name: "N", initials: "N", role: "r", category: "MSC", department: "", bio: "", photoUrl: "", sortOrder: 0 };
t("isOwnProfile: guest is never the owner", isOwnProfile(null, ME) === false);
t("isOwnProfile: owner", isOwnProfile(actors[1][1], ME) === true);
t("isOwnProfile: any role owns only their own profile", isOwnProfile(actors[3][1], "other") === false && isOwnProfile(actors[2][1], "other") === false);
t("isOwnProfile: unlinked profile is nobody's", isOwnProfile(actors[1][1], null) === false);
t("toTeamMember: own profile -> isOwn true", toTeamMember(profileRow, actors[1][1]).isOwn === true);
t("toTeamMember: guest -> isOwn false", toTeamMember(profileRow, null).isOwn === false);
t("toTeamMember: output has no userId key and no account id anywhere", !("userId" in toTeamMember(profileRow, actors[1][1])) && !JSON.stringify(toTeamMember(profileRow, actors[1][1])).includes(ME));

// Audit tripwire.
const fakeDb = { auditLog: { create: async () => ({}) } } as never;
const audit = (details: Record<string, string>) =>
  recordAudit(fakeDb, { actor: null, action: "USER_CREATED", entityType: "USER", details });
for (const key of ["password", "passwordHash", "newPassword", "token", "sessionId", "messageBody", "body", "content", "secret", "cookie"]) {
  let threw = false;
  await audit({ [key]: "x" }).catch(() => (threw = true));
  t(`audit rejects key "${key}"`, threw);
}
for (const key of ["email", "role", "from", "to", "title", "changed", "added", "removed", "visibility", "teamMemberId", "roleChanged"]) {
  let threw = false;
  await audit({ [key]: "x" }).catch(() => (threw = true));
  t(`audit accepts key "${key}"`, !threw);
}

console.log(`\n${ok} unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

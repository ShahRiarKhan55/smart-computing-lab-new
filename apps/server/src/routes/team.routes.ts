import { Router } from "express";
import {
  ALUMNI_CATEGORY,
  ALUMNI_MESSAGES,
  CATEGORY_ORDER,
  canCreateTeamMember,
  canDeleteTeamMember,
  canManageTeamPlacement,
  canPublishMember,
  createTeamMemberSchema,
  setPublicationSchema,
  updateTeamMemberSchema,
} from "@scl/shared";
import { interactiveTransactionOptions, prisma } from "../lib/prisma.js";
import { transientContentionAs503 } from "../lib/dbErrors.js";
import { removeRetiredBlob, retireReplacedPhoto } from "../lib/profilePhoto.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireCan, requireOwnerOrManager } from "../middleware/auth.js";
import { toTeamMember } from "../lib/serializers.js";
import { assertValidId } from "../lib/authorLinks.js";
import { changedFields, recordAudit } from "../lib/audit.js";
import { assertMayBecomeAlumni, isAlumniCategory } from "../lib/alumni.js";
import { isMemberVisible, mayManageAlumni, publishedMemberWhere, rejectPublicationField } from "../lib/memberVisibility.js";
import { applyTranslationOverrides, loadTranslations, localize, resolveLocale } from "../lib/translations.js";

const router = Router();

const AUDITED_FIELDS = ["name", "initials", "role", "category", "department", "bio", "photoUrl", "sortOrder", "isPublished"] as const;

// GET /api/team -> list the CURRENT team members the viewer may see, grouped by category order (public).
// Alumni are not part of the roster: they are listed by GET /api/alumni (routes/alumni.routes.ts), so every existing consumer of this
// list (home page counts, link dropdowns, the team page) behaves exactly as before. The visibility filter still applies.
// A relationship PICKER (publication authors, project / group members, research-area researchers) opts in with `?includeAlumni=1` to also
// list PUBLISHED alumni (an administrator also gets unpublished ones); the default response is unchanged.
// `isOwn` is computed per viewer; the account id is never returned.
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const locale = resolveLocale(req);
    const rows = await prisma.teamMember.findMany({
      where: { ...publishedMemberWhere(viewer), ...(req.query.includeAlumni === "1" ? {} : { NOT: { category: ALUMNI_CATEGORY } }) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const translations = await loadTranslations(prisma, "TEAM_MEMBER", rows.map((r) => r.id), locale);
    const members = rows.map((r) => toTeamMember(localize(r, "TEAM_MEMBER", translations), viewer));
    // Alumni (only present with `includeAlumni=1`) sort after every roster group.
    const rank = (c: string) => (CATEGORY_ORDER.includes(c as (typeof CATEGORY_ORDER)[number]) ? CATEGORY_ORDER.indexOf(c as (typeof CATEGORY_ORDER)[number]) : CATEGORY_ORDER.length);
    members.sort((a, b) => rank(a.category) - rank(b.category));
    res.json(members);
  }),
);

// GET /api/team/:id -> single member (public)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.teamMember.findUnique({ where: { id: req.params.id } });
    if (!row || !isMemberVisible(req.user ?? null, row)) throw new HttpError(404, "Not found");
    const translations = await loadTranslations(prisma, "TEAM_MEMBER", [row.id], resolveLocale(req));
    res.json(toTeamMember(localize(row, "TEAM_MEMBER", translations), req.user ?? null));
  }),
);

// POST /api/team -> create (lab manager or admin)
router.post(
  "/",
  requireCan(canCreateTeamMember),
  asyncHandler(async (req, res) => {
    rejectPublicationField(req.body);
    const body = parseOrThrow(createTeamMemberSchema, req.body);
    // Alumni are a public directory of people who may not have consented to it: only an administrator may create one,
    // and it is ALWAYS created unpublished (publishing is a separate, explicit admin action).
    const isAlumni = isAlumniCategory(body.category);
    if (isAlumni && !mayManageAlumni(req.user)) throw new HttpError(403, ALUMNI_MESSAGES.adminOnly);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.teamMember.create({
        data: {
          userId: null,
          name: body.name,
          initials: body.initials,
          role: body.role,
          category: body.category,
          department: body.department,
          bio: body.bio,
          photoUrl: body.photoUrl,
          sortOrder: body.sortOrder,
          isPublished: !isAlumni,
        },
      });
      await applyTranslationOverrides(tx, "TEAM_MEMBER", row.id, body.translations?.ja);
      await recordAudit(tx, {
        actor: req.user!,
        action: "TEAM_MEMBER_CREATED",
        entityType: "TEAM_MEMBER",
        entityId: row.id,
        details: { name: row.name, category: row.category },
      });
      return row;
    });
    res.status(201).json(toTeamMember(created, req.user!));
  }),
);

// PUT /api/team/:id -> update (the member's own linked account, or a lab manager/admin)
router.put(
  "/:id",
  requireOwnerOrManager("id"),
  asyncHandler(async (req, res) => {
    rejectPublicationField(req.body);
    const body = parseOrThrow(updateTeamMemberSchema, req.body);
    const mayPlace = canManageTeamPlacement(req.user!);

    const { updated, retiredKey } = await prisma.$transaction(async (tx) => {
      // The FIRST statement is a write (no read-lock-then-upgrade; see PUT /api/profile and docs/architecture/phase13-files-and-gallery.md),
      // but it only ever touches a profile this requester may see AND may manage: a hidden profile, or an alumni profile for a non-admin,
      // matches nothing, so its `updatedAt` is never written on their behalf. Whatever the outcome, a refused request throws inside this
      // transaction, which rolls the lock write back as well.
      const locked = await tx.teamMember.updateMany({
        where: { id: req.params.id, ...publishedMemberWhere(req.user), ...(mayManageAlumni(req.user) ? {} : { NOT: { category: ALUMNI_CATEGORY } }) },
        data: { updatedAt: new Date() },
      });
      if (locked.count === 0) {
        // Nothing was written. Decide the answer: an alumni profile the viewer can see but may not manage is 403 (as before); anything
        // else (missing, or hidden from this viewer) is an indistinguishable 404.
        const probe = await tx.teamMember.findUnique({ where: { id: req.params.id } });
        if (probe && isMemberVisible(req.user, probe) && isAlumniCategory(probe.category) && !mayManageAlumni(req.user)) {
          throw new HttpError(403, ALUMNI_MESSAGES.adminOnly);
        }
        throw new HttpError(404, "Not found");
      }
      const existing = await tx.teamMember.findUnique({ where: { id: req.params.id } });
      // A profile the viewer may not see answers exactly like a missing one (defence in depth: the lock above already required it).
      if (!existing || !isMemberVisible(req.user, existing)) throw new HttpError(404, "Not found");

      // Alumni are admin-only in every direction: editing one, moving a profile into ALUMNI, and moving one out.
      const targetCategory = mayPlace ? body.category ?? existing.category : existing.category;
      const wasAlumni = isAlumniCategory(existing.category);
      const willBeAlumni = isAlumniCategory(targetCategory);
      if ((wasAlumni || willBeAlumni) && !mayManageAlumni(req.user)) throw new HttpError(403, ALUMNI_MESSAGES.adminOnly);
      if (willBeAlumni && !wasAlumni) assertMayBecomeAlumni(existing);

      // Only managers change category or sort order; for anyone else those two
      // fields are ignored, so editing your own profile can never move you.
      const data = {
        name: body.name ?? existing.name,
        initials: body.initials ?? existing.initials,
        role: body.role ?? existing.role,
        department: body.department ?? existing.department,
        bio: body.bio ?? existing.bio,
        photoUrl: body.photoUrl ?? existing.photoUrl,
        category: targetCategory,
        sortOrder: mayPlace ? body.sortOrder ?? existing.sortOrder : existing.sortOrder,
        // The publication flag is written ONLY when the category actually enters or leaves ALUMNI. Entering unpublishes (consent has not
        // been given for the directory); leaving makes the profile a normal roster entry (the roster is public by existing policy), so
        // only ALUMNI profiles are ever unpublished. An ordinary edit leaves the column out of the UPDATE entirely: it neither resets it
        // nor writes back the value read earlier in this transaction, so it can never undo a publish/unpublish made in between.
        ...(wasAlumni !== willBeAlumni ? { isPublished: !willBeAlumni } : {}),
      };
      // photoUrl is written only when the request names it, in BOTH write branches below, so no edit (a text-only save or a category
      // change) can put back a stale photo that a concurrent upload or removal has just replaced.
      const { photoUrl: _unchanged, ...textData } = data;
      const writeData = body.photoUrl === undefined ? textData : data;
      let row;
      if (willBeAlumni && !wasAlumni) {
        // Conditional on "still has no account", so an account linked concurrently can never end up on an alumni profile.
        const moved = await tx.teamMember.updateMany({ where: { id: existing.id, userId: null }, data: writeData });
        if (moved.count !== 1) throw new HttpError(409, ALUMNI_MESSAGES.hasAccount);
        row = await tx.teamMember.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        row = await tx.teamMember.update({ where: { id: req.params.id }, data: writeData });
      }
      // Replacing or clearing an uploaded photo retires the old file of THIS member in the same transaction (no-op if the URL is unchanged).
      const retiredKey = await retireReplacedPhoto(tx, { memberId: existing.id, previousPhotoUrl: existing.photoUrl, nextPhotoUrl: row.photoUrl, actor: req.user!, reason: "replaced-profile-photo" });
      await applyTranslationOverrides(tx, "TEAM_MEMBER", row.id, body.translations?.ja);
      const changed = changedFields(existing, data, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "TEAM_MEMBER_UPDATED",
          entityType: "TEAM_MEMBER",
          entityId: row.id,
          details: { name: row.name, changed },
        });
      }
      return { updated: row, retiredKey };
    }, interactiveTransactionOptions);
    // The blob goes only after the commit (a rolled-back request keeps its file).
    await removeRetiredBlob(retiredKey);

    res.json(toTeamMember(updated, req.user!));
  }),
);

// PUT /api/team/:id/publication -> publish / unpublish an ALUMNI profile on the public pages (admin only, explicit).
// Nothing else changes `isPublished`: not creating, not editing, not a payload field on the other routes.
router.put(
  "/:id/publication",
  requireCan(canPublishMember),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const body = parseOrThrow(setPublicationSchema, req.body);
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.teamMember.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      if (existing.category !== ALUMNI_CATEGORY) throw new HttpError(409, ALUMNI_MESSAGES.alumniOnlyPublication);
      // Compare-and-swap: the write applies only while the profile STILL has the category and consent state this request read. Otherwise
      // (a concurrent category change, publication change, reset or delete) nothing is written and the admin is asked to retry, instead of
      // overwriting newer state with a stale decision (e.g. hiding a profile that is no longer alumni, or publishing one whose consent was reset).
      const swapped = await tx.teamMember.updateMany({
        where: { id: existing.id, category: ALUMNI_CATEGORY, isPublished: existing.isPublished },
        data: { isPublished: body.isPublished },
      });
      if (swapped.count !== 1) throw new HttpError(409, ALUMNI_MESSAGES.publicationConflict);
      const updatedRow = await tx.teamMember.findUniqueOrThrow({ where: { id: existing.id } });
      if (existing.isPublished !== body.isPublished) {
        await recordAudit(tx, {
          actor: req.user!,
          action: body.isPublished ? "TEAM_MEMBER_PUBLISHED" : "TEAM_MEMBER_UNPUBLISHED",
          entityType: "TEAM_MEMBER",
          entityId: existing.id,
          details: { name: existing.name, category: existing.category },
        });
      }
      return updatedRow;
    });
    res.json(toTeamMember(row, req.user!));
  }),
);

// DELETE /api/team/:id -> delete (admin only: it removes a person's profile and history)
router.delete(
  "/:id",
  requireCan(canDeleteTeamMember),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const retiredKey = await prisma.$transaction(async (tx) => {
      // Write first, then read (see PUT /api/profile): no read-lock-then-upgrade. Admin only, so every profile is visible to the actor.
      const locked = await tx.teamMember.updateMany({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
      const existing = locked.count === 0 ? null : await tx.teamMember.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      // The member's uploaded profile photo must not outlive the profile (it would stay a live, never-cleaned file).
      const photoKey = await retireReplacedPhoto(tx, { memberId: existing.id, previousPhotoUrl: existing.photoUrl, nextPhotoUrl: "", actor: req.user!, reason: "member-deleted" });

      await tx.translation.deleteMany({ where: { entityType: "TEAM_MEMBER", entityId: existing.id } });
      await tx.teamMember.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "TEAM_MEMBER_DELETED",
        entityType: "TEAM_MEMBER",
        entityId: existing.id,
        details: { name: existing.name, category: existing.category, hadAccount: existing.userId !== null },
      });
      return photoKey;
    }, interactiveTransactionOptions);
    await removeRetiredBlob(retiredKey);
    res.json({ success: true });
  }),
);

// Lock contention answers 503 + Retry-After (lib/dbErrors.ts); other errors fall through to the application error handler.
// Mounted AFTER every route above, including the publication route.
router.use(transientContentionAs503);

export default router;

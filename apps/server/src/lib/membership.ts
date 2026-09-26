import type { Router, RequestHandler } from "express";
import type { Prisma } from "@prisma/client";
import type { ZodType, ZodTypeDef } from "zod";
import { prisma } from "./prisma.js";
import { asyncHandler } from "./asyncHandler.js";
import { HttpError, parseOrThrow } from "./validate.js";
import { assertValidId } from "./authorLinks.js";
import { idList, recordAudit, type AuditAction, type AuditEntityType } from "./audit.js";

/**
 * Phase 21: single-researcher membership writes (add / change role / remove) for a project or a group.
 * They exist because the Phase 9 `PUT /:id/members` replaces the WHOLE set from the client's copy of the
 * list — fine for a checkbox dialog, wrong for "add Aiko to this project" from a page whose copy of the
 * list may be stale. Nothing new is authorised: the guard is the same `requireProjectEditor` /
 * `requireGroupEditor` (manager, or a LEAD of that project/group), the rows are the same join rows, and
 * the audit row is the same action with the same detail keys.
 *
 * Error contract (also the security contract): 401 guest, 400 malformed id / body, 403 not a manager and
 * not a lead of THIS parent (also for an unknown parent, so a member cannot probe ids), 404 unknown parent
 * (managers), 400 unknown team member, 409 already a member, 404 not a member (role change / remove).
 * No bulk form exists: one relationship per request.
 */
interface Cfg {
  guard: RequestHandler;
  addSchema: ZodType<{ teamMemberId: string; role: string }, ZodTypeDef, unknown>;
  roleSchema: ZodType<{ role: string }, ZodTypeDef, unknown>;
  action: AuditAction;
  entityType: AuditEntityType;
  /** Parent + its member rows, accessed through the model that owns them. */
  parent: {
    load(tx: Prisma.TransactionClient, id: string): Promise<{ id: string; label: string; labelKey: "title" | "name" } | null>;
    find(tx: Prisma.TransactionClient, parentId: string, teamMemberId: string): Promise<{ role: string } | null>;
    leads(tx: Prisma.TransactionClient, parentId: string): Promise<string[]>;
    create(tx: Prisma.TransactionClient, parentId: string, teamMemberId: string, role: string): Promise<unknown>;
    update(tx: Prisma.TransactionClient, parentId: string, teamMemberId: string, role: string): Promise<unknown>;
    remove(tx: Prisma.TransactionClient, parentId: string, teamMemberId: string): Promise<unknown>;
  };
}

export function mountMemberRoutes(router: Router, cfg: Cfg): void {
  const { parent } = cfg;

  /** Runs `change` in one transaction with the audit row, so a rejected request leaves no trace. */
  async function run(
    req: Parameters<RequestHandler>[0],
    parentId: string,
    teamMemberId: string,
    change: (tx: Prisma.TransactionClient, p: NonNullable<Awaited<ReturnType<typeof parent.load>>>) => Promise<{ added?: string; removed?: string; roleChanged?: number }>,
  ) {
    await prisma.$transaction(async (tx) => {
      const p = await parent.load(tx, parentId);
      if (!p) throw new HttpError(404, "Not found");
      const before = await parent.leads(tx, parentId);
      const r = await change(tx, p);
      const after = await parent.leads(tx, parentId);
      await recordAudit(tx, {
        actor: req.user!,
        action: cfg.action,
        entityType: cfg.entityType,
        entityId: p.id,
        details: {
          [p.labelKey]: p.label,
          added: r.added ?? "",
          removed: r.removed ?? "",
          roleChanged: r.roleChanged ?? 0,
          leadChanged: before.join(",") !== after.join(","),
          leads: idList(after),
        },
      });
    });
  }

  // POST /:id/members { teamMemberId, role? } -> add ONE researcher (201). Already a member: 409.
  router.post(
    "/:id/members",
    cfg.guard,
    asyncHandler(async (req, res) => {
      const { teamMemberId, role } = parseOrThrow(cfg.addSchema, req.body);
      await run(req, req.params.id, teamMemberId, async (tx) => {
        if (!(await tx.teamMember.findUnique({ where: { id: teamMemberId }, select: { id: true } }))) {
          throw new HttpError(400, "One or more team members do not exist.");
        }
        if (await parent.find(tx, req.params.id, teamMemberId)) throw new HttpError(409, "That researcher is already a member.");
        await parent.create(tx, req.params.id, teamMemberId, role);
        return { added: teamMemberId };
      });
      res.status(201).json({ success: true });
    }),
  );

  // PUT /:id/members/:teamMemberId { role } -> change ONE researcher's role (incl. lead). Not a member: 404.
  router.put(
    "/:id/members/:teamMemberId",
    cfg.guard,
    asyncHandler(async (req, res) => {
      assertValidId(req.params.teamMemberId);
      const { role } = parseOrThrow(cfg.roleSchema, req.body);
      await run(req, req.params.id, req.params.teamMemberId, async (tx) => {
        const current = await parent.find(tx, req.params.id, req.params.teamMemberId);
        if (!current) throw new HttpError(404, "That researcher is not a member.");
        if (current.role === role) throw new HttpError(409, "That researcher already has this role.");
        await parent.update(tx, req.params.id, req.params.teamMemberId, role);
        return { roleChanged: 1 };
      });
      res.json({ success: true });
    }),
  );

  // DELETE /:id/members/:teamMemberId -> remove ONE researcher. Not a member: 404.
  router.delete(
    "/:id/members/:teamMemberId",
    cfg.guard,
    asyncHandler(async (req, res) => {
      assertValidId(req.params.teamMemberId);
      await run(req, req.params.id, req.params.teamMemberId, async (tx) => {
        if (!(await parent.find(tx, req.params.id, req.params.teamMemberId))) throw new HttpError(404, "That researcher is not a member.");
        await parent.remove(tx, req.params.id, req.params.teamMemberId);
        return { removed: req.params.teamMemberId };
      });
      res.json({ success: true });
    }),
  );
}

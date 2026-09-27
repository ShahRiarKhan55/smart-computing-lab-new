/**
 * Proves the lab-resource read paths issue a BOUNDED, DATA-INDEPENDENT number of database operations (no N+1:
 * nothing is fetched per resource, project, area, group or researcher), never return more rows than the page
 * asks for, and only ever read. Covers the list, the detail, the project section (reproducibility panel), the
 * knowledge-document section, search, the workspace and the admin list, each with a normal fixture (5 resources)
 * and 17x that (85). It inserts throw-away rows, so run it ONLY against a COPY of the database:
 *   DATABASE_URL=file:C:/abs/copy.db tsx scripts/resources-queries.test.ts
 */
import { RESOURCE_LIST_MAX_LIMIT, RESOURCE_PANEL_LIMIT, RESOURCE_SECTION_LIMIT, adminContentQuerySchema, resourceListQuerySchema, searchQuerySchema } from "@scl/shared";
import { prisma } from "../src/lib/prisma.js";
import { detailInclude, listInclude, loadResourceSection, resourceOrderBy, resourceWhere, serializeResources } from "../src/lib/resources.js";
import { runSearch } from "../src/lib/search.js";
import { loadWorkspace } from "../src/lib/workspace.js";
import { listAdminContent } from "../src/lib/adminContent.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));

let ops: string[] = [];
prisma.$use((params, next) => {
  ops.push(`${params.model}.${params.action}`);
  return next(params);
});

type Viewer = { id: string; role: "MEMBER" | "LAB_MANAGER" } | null;
async function list(viewer: Viewer, locale: "en" | "ja", limit: number, extra: Record<string, string> = {}) {
  ops = [];
  const query = resourceListQuerySchema.parse({ limit: String(limit), ...extra });
  const where = await resourceWhere(query, viewer);
  const [rows, total] = await Promise.all([
    prisma.labResource.findMany({ where, include: listInclude(viewer), orderBy: resourceOrderBy, take: query.limit }),
    prisma.labResource.count({ where }),
  ]);
  const items = await serializeResources(rows, viewer, locale);
  return { items, total, ops: [...ops] };
}
async function detail(viewer: Viewer, locale: "en" | "ja", id: string) {
  ops = [];
  const row = await prisma.labResource.findFirst({ where: { id }, include: detailInclude(viewer) });
  const [r] = await serializeResources(row ? [row] : [], viewer, locale, true);
  return { r, ops: [...ops] };
}
async function section(viewer: NonNullable<Viewer>, locale: "en" | "ja", filter: Record<string, string>, take: number) {
  ops = [];
  const s = await loadResourceSection(await resourceWhere(resourceListQuerySchema.parse(filter), viewer), viewer, locale, take);
  return { s, ops: [...ops] };
}

const MARK = "ZZ ResCost";
async function cleanup() {
  const rs = await prisma.labResource.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  await prisma.translation.deleteMany({ where: { entityType: "LAB_RESOURCE", entityId: { in: rs.map((d) => d.id) } } });
  await prisma.labResource.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.knowledgeDoc.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "rescost-" } } });
}

async function populate(n: number, actor: { userId: string; tmId: string }, ctx: { project: { id: string }; doc: { id: string } }) {
  const area = await prisma.researchArea.create({ data: { title: `${MARK} area ${Date.now()}-${n}`, description: "d", tag: "z", visibility: "PUBLIC" } });
  const group = await prisma.researchGroup.create({ data: { slug: `zz-rescost-g-${Date.now()}-${n}`, name: `${MARK} group ${n}`, visibility: "LAB_ONLY" } });
  for (let i = 0; i < n; i++) {
    // Every resource points at ITS OWN projects so a per-row lookup would show up as extra operations.
    const own = await prisma.researchProject.create({ data: { slug: `zz-rescost-p-${Date.now()}-${n}-${i}`, title: `${MARK} project ${n}-${i}`, visibility: i % 2 ? "PUBLIC" : "LAB_ONLY" } });
    const r = await prisma.labResource.create({
      data: {
        name: `${MARK} res ${n}-${i}`,
        resourceType: i % 2 ? "DATASET" : "FPGA",
        description: `description ${i} `.repeat(10),
        version: `v${i}`,
        vendor: "V",
        identifier: `ID-${n}-${i}`,
        environment: "env",
        metadata: JSON.stringify(i % 2 ? { format: "CSV" } : { firmwareVersion: "1" }),
        visibility: i % 4 === 0 ? "PUBLIC" : "LAB_ONLY",
        ownerId: actor.userId,
        researchAreaId: area.id,
        groupId: group.id,
        knowledgeDocId: ctx.doc.id,
        teamMemberId: actor.tmId,
        projectLinks: { create: [{ projectId: own.id }, { projectId: ctx.project.id }] },
      },
    });
    if (i % 2 === 0) await prisma.translation.createMany({ data: [{ entityType: "LAB_RESOURCE", entityId: r.id, locale: "ja", field: "name", value: `${MARK} 日本語 ${n}-${i}` }, { entityType: "LAB_RESOURCE", entityId: r.id, locale: "ja", field: "description", value: "日本語の説明" }] });
  }
}

async function main() {
  await cleanup();
  const user = await prisma.user.create({ data: { email: "rescost-a@example.test", passwordHash: "x", role: "MEMBER" } });
  const mgrUser = await prisma.user.create({ data: { email: "rescost-m@example.test", passwordHash: "x", role: "LAB_MANAGER" } });
  const me = await prisma.teamMember.create({ data: { name: `${MARK} me`, initials: "ZR", role: "R", category: "RESEARCH", userId: user.id } });
  const viewer: Viewer = { id: user.id, role: "MEMBER" };
  const manager: NonNullable<Viewer> = { id: mgrUser.id, role: "LAB_MANAGER" };
  const project = await prisma.researchProject.create({ data: { slug: `zz-rescost-shared-${Date.now()}`, title: `${MARK} shared project`, visibility: "LAB_ONLY" } });
  await prisma.projectMember.create({ data: { projectId: project.id, teamMemberId: me.id, role: "MEMBER" } });
  const doc = await prisma.knowledgeDoc.create({ data: { title: `${MARK} shared doc`, body: "b", visibility: "LAB_ONLY" } });
  const ctx = { project, doc };
  try {
    await populate(5, { userId: user.id, tmId: me.id }, ctx);
    const smallEn = await list(viewer, "en", 12);
    const smallJa = await list(viewer, "ja", 12);
    const smallGuest = await list(null, "en", 12);
    const smallDetail = await detail(viewer, "ja", smallEn.items[0].id);
    const smallProject = await section(viewer, "ja", { project: project.id }, RESOURCE_PANEL_LIMIT);
    const smallDoc = await section(viewer, "ja", { knowledge: doc.id }, RESOURCE_SECTION_LIMIT);
    const search = (v: Viewer, raw: Record<string, string>, locale: "en" | "ja" = "en") => {
      ops = [];
      return runSearch(v, searchQuerySchema.parse(raw), locale).then((res) => ({ res, ops: [...ops] }));
    };
    const smallSearch = await search(viewer, { q: MARK, type: "resource", limit: "50" }, "ja");
    const wsRun = async (locale: "en" | "ja") => {
      ops = [];
      const res = await loadWorkspace(viewer!, locale);
      return { res, ops: [...ops] };
    };
    const smallWs = await wsRun("en");
    const smallWsJa = await wsRun("ja");
    const admin = async (extra: Record<string, string>, locale: "en" | "ja" = "en") => {
      ops = [];
      const res = await listAdminContent(adminContentQuerySchema.parse({ type: "resource", limit: "100", ...extra }), manager, locale);
      return { res, ops: [...ops] };
    };
    const smallAdmin = await admin({ q: MARK });
    t("small data: the list is populated", smallEn.items.length === 5 && smallEn.total === 5, `${smallEn.items.length}/${smallEn.total}`);

    await populate(80, { userId: user.id, tmId: me.id }, ctx);
    const bigEn = await list(viewer, "en", 12);
    const bigJa = await list(viewer, "ja", 12);
    const bigMax = await list(viewer, "ja", RESOURCE_LIST_MAX_LIMIT);
    const bigGuest = await list(null, "en", 12);
    const bigDetail = await detail(viewer, "ja", bigEn.items[0].id);
    const bigProject = await section(viewer, "ja", { project: project.id }, RESOURCE_PANEL_LIMIT);
    const bigDoc = await section(viewer, "ja", { knowledge: doc.id }, RESOURCE_SECTION_LIMIT);
    const bigFiltered = await list(viewer, "ja", 12, { q: `${MARK} res`, type: "DATASET" });
    const bigFilteredMax = await list(viewer, "ja", RESOURCE_LIST_MAX_LIMIT, { q: `${MARK} res`, type: "DATASET" });
    const bigSearch = await search(viewer, { q: MARK, type: "resource", limit: "50" }, "ja");
    const bigWs = await wsRun("en");
    const bigWsJa = await wsRun("ja");
    const bigAdmin = await admin({ q: MARK });

    t("big data: a page is capped at the limit, the true total is reported", bigEn.items.length === 12 && bigEn.total === 85 && bigMax.items.length === RESOURCE_LIST_MAX_LIMIT && bigMax.total === 85, `${bigEn.items.length}/${bigEn.total}/${bigMax.items.length}`);
    t("English list: exactly 2 database operations (rows + count), whatever the data", smallEn.ops.length === 2 && bigEn.ops.length === 2, `${smallEn.ops.join(",")} | ${bigEn.ops.join(",")}`);
    t("Japanese list adds only batched translation lookups: resource, project, area, group (4), identical for 5 and 85 rows and for 12 and 50 per page", smallJa.ops.length === bigJa.ops.length && bigJa.ops.length === bigMax.ops.length && bigJa.ops.length - bigEn.ops.length <= 4, `${smallJa.ops.length} / ${bigJa.ops.length} / ${bigMax.ops.length}`);
    t("guest list costs the same as a member list", smallGuest.ops.length === bigGuest.ops.length && bigGuest.ops.length === 2);
    t("detail: one row + at most 6 batched translation lookups, whatever the data", smallDetail.ops.length === bigDetail.ops.length && bigDetail.ops.length <= 7, `${smallDetail.ops.length}/${bigDetail.ops.length}: ${bigDetail.ops.join(",")}`);
    t("the detail names every project of the resource, the list card at most 3, and counts them all", bigDetail.r.projects.length === 2 && bigEn.items.every((r) => r.projects.length <= 3 && r.projectCount === 2), `${bigDetail.r.projects.length}`);
    t("project section (reproducibility panel): bounded rows + count + at most 4 translation lookups, whatever the data", smallProject.ops.length === bigProject.ops.length && bigProject.ops.length <= 6 && bigProject.s.items.length === RESOURCE_PANEL_LIMIT && bigProject.s.total === 85, `${bigProject.ops.join(",")} ${bigProject.s.items.length}/${bigProject.s.total}`);
    t("knowledge-document section: bounded rows + count + at most 4 translation lookups, whatever the data", smallDoc.ops.length === bigDoc.ops.length && bigDoc.ops.length <= 6 && bigDoc.s.items.length === RESOURCE_SECTION_LIMIT && bigDoc.s.total === 85, `${bigDoc.ops.join(",")} ${bigDoc.s.items.length}/${bigDoc.s.total}`);
    // "ZZ ResCost res" is THREE words: the Japanese-override match is one Translation query per WORD (the search helper's
    // documented cost), so 3 + rows + count + 4 batched lookups = 9, and it does not depend on how many rows there are.
    t("a text + type filtered list costs one override query per search WORD plus the fixed list cost (not per row)", bigFiltered.ops.length === 9 && bigFilteredMax.ops.length === 9 && bigFiltered.items.length === 12 && bigFilteredMax.total === 42 && bigFilteredMax.items.length === 42, `${bigFiltered.ops.length}/${bigFilteredMax.ops.length}: ${bigFiltered.ops.join(",")}`);
    t("search (type=resource): identical cost for 5 and 85 resources, one page of results", smallSearch.ops.length === bigSearch.ops.length && bigSearch.res.results.length === 50 && bigSearch.res.pagination.total === 85 && bigSearch.ops.length <= 30, `${smallSearch.ops.length}/${bigSearch.ops.length}: ${bigSearch.ops.join(",")}`);
    t("search: nothing is looked up per result (the `related` query is one per type present)", bigSearch.ops.filter((o) => o === "LabResource.findMany").length <= 4, bigSearch.ops.join(","));
    t("workspace: the resources section adds a fixed cost; English and Japanese are identical between small and big data", smallWs.ops.length === bigWs.ops.length && smallWsJa.ops.length === bigWsJa.ops.length && bigWs.res.resources.items.length === RESOURCE_SECTION_LIMIT && bigWs.res.resources.total === 85, `${smallWs.ops.length}/${bigWs.ops.length} ${smallWsJa.ops.length}/${bigWsJa.ops.length} ${bigWs.res.resources.total}`);
    t("workspace: the resources section is at most 5 rows + 1 count", bigWsJa.ops.filter((o) => /^LabResource\./.test(o)).length === 2, bigWsJa.ops.filter((o) => /^LabResource\./.test(o)).join(","));
    t("admin list: rows + count + one override lookup per search word (+ one page lookup), independent of the data", smallAdmin.ops.length === bigAdmin.ops.length && bigAdmin.res.rows.length === 85 && bigAdmin.ops.length <= 9, `${smallAdmin.ops.length}/${bigAdmin.ops.length}: ${bigAdmin.ops.join(",")}`);
    t("only reads, and only the models resources may read", [...bigEn.ops, ...bigJa.ops, ...bigDetail.ops, ...bigProject.ops, ...bigDoc.ops, ...bigFiltered.ops, ...bigFilteredMax.ops, ...bigAdmin.ops].every((o) => /^(LabResource|Translation)\.(findMany|findFirst|count)$/.test(o)), [...new Set([...bigJa.ops, ...bigFiltered.ops, ...bigAdmin.ops])].join());
    t("workspace and search touch no private model (User, Session, AuditLog, Message, Notification, StoredFile)", [...bigWs.ops, ...bigWsJa.ops, ...bigSearch.ops].every((o) => !/^(User|Session|AuditLog|Message|Notification|StoredFile|Conversation)/.test(o) && /\.(findUnique|findMany|findFirst|count)$/.test(o)));
    const again = await list(viewer, "ja", 12);
    t("two identical reads return byte-identical JSON (deterministic order)", JSON.stringify(again.items) === JSON.stringify(bigJa.items));
    t("no row of another visibility class leaks into a guest list", bigGuest.items.length === 12 && bigGuest.total === (await prisma.labResource.count({ where: { visibility: "PUBLIC" } })));
  } finally {
    await cleanup();
  }
  console.log(`${ok} resource query-cost checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Script crashed:", e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());

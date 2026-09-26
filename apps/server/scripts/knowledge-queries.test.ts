/**
 * Proves the knowledge read paths issue a BOUNDED, DATA-INDEPENDENT number of database operations (no N+1:
 * nothing is fetched per document, project, area, group or researcher), never return more rows than the page
 * asks for, and only ever read. It inserts throw-away rows, so run it ONLY against a COPY of the database:
 *   DATABASE_URL=file:C:/abs/copy.db tsx scripts/knowledge-queries.test.ts
 */
import { KNOWLEDGE_SECTION_LIMIT, KNOWLEDGE_LIST_MAX_LIMIT, knowledgeListQuerySchema } from "@scl/shared";
import { prisma } from "../src/lib/prisma.js";
import { knowledgeInclude, knowledgeOrderBy, knowledgeWhere, loadKnowledgeSection, serializeKnowledge } from "../src/lib/knowledge.js";

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
  const query = knowledgeListQuerySchema.parse({ limit: String(limit), ...extra });
  const where = await knowledgeWhere(query, viewer);
  const [rows, total] = await Promise.all([
    prisma.knowledgeDoc.findMany({ where, include: knowledgeInclude, orderBy: knowledgeOrderBy, take: query.limit }),
    prisma.knowledgeDoc.count({ where }),
  ]);
  const items = await serializeKnowledge(rows, viewer, locale);
  return { items, total, ops: [...ops] };
}
async function detail(viewer: Viewer, locale: "en" | "ja", id: string) {
  ops = [];
  const row = await prisma.knowledgeDoc.findFirst({ where: { id }, include: knowledgeInclude });
  const [doc] = await serializeKnowledge(row ? [row] : [], viewer, locale, true);
  return { doc, ops: [...ops] };
}
async function section(viewer: NonNullable<Viewer>, locale: "en" | "ja") {
  ops = [];
  const s = await loadKnowledgeSection(await knowledgeWhere(knowledgeListQuerySchema.parse({}), viewer), viewer, locale, KNOWLEDGE_SECTION_LIMIT);
  return { s, ops: [...ops] };
}

const MARK = "ZZ KnowCost";
async function cleanup() {
  const docs = await prisma.knowledgeDoc.findMany({ where: { title: { startsWith: MARK } }, select: { id: true } });
  await prisma.translation.deleteMany({ where: { entityType: "KNOWLEDGE_DOC", entityId: { in: docs.map((d) => d.id) } } });
  await prisma.knowledgeDoc.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "knowcost-" } } });
}

async function populate(n: number, actor: { userId: string; tmId: string }) {
  const area = await prisma.researchArea.create({ data: { title: `${MARK} area ${Date.now()}`, description: "d", tag: "z", visibility: "PUBLIC" } });
  const group = await prisma.researchGroup.create({ data: { slug: `zz-knowcost-g-${Date.now()}-${n}`, name: `${MARK} group ${n}`, visibility: "LAB_ONLY" } });
  const project = await prisma.researchProject.create({ data: { slug: `zz-knowcost-p-${Date.now()}-${n}`, title: `${MARK} project ${n}`, visibility: "LAB_ONLY", groupId: group.id } });
  await prisma.projectMember.create({ data: { projectId: project.id, teamMemberId: actor.tmId, role: "MEMBER" } });
  for (let i = 0; i < n; i++) {
    // Every document points at ITS OWN project/area/group so a per-row lookup would show up as extra operations.
    const p = i % 3 === 0 ? project : await prisma.researchProject.create({ data: { slug: `zz-knowcost-p-${Date.now()}-${n}-${i}`, title: `${MARK} project ${n}-${i}`, visibility: i % 2 ? "PUBLIC" : "LAB_ONLY" } });
    const d = await prisma.knowledgeDoc.create({
      data: { title: `${MARK} doc ${n}-${i}`, body: `body ${i} `.repeat(20), category: "DATASET", visibility: i % 4 === 0 ? "PUBLIC" : "LAB_ONLY", authorId: actor.userId, projectId: p.id, researchAreaId: area.id, groupId: group.id, teamMemberId: actor.tmId },
    });
    if (i % 2 === 0) await prisma.translation.createMany({ data: [{ entityType: "KNOWLEDGE_DOC", entityId: d.id, locale: "ja", field: "title", value: `${MARK} 日本語 ${n}-${i}` }, { entityType: "KNOWLEDGE_DOC", entityId: d.id, locale: "ja", field: "body", value: "日本語の本文" }] });
  }
}

async function main() {
  await cleanup();
  const user = await prisma.user.create({ data: { email: "knowcost-a@example.test", passwordHash: "x", role: "MEMBER" } });
  const me = await prisma.teamMember.create({ data: { name: `${MARK} me`, initials: "ZK", role: "R", category: "RESEARCH", userId: user.id } });
  const viewer: Viewer = { id: user.id, role: "MEMBER" };
  try {
    await populate(5, { userId: user.id, tmId: me.id });
    const smallEn = await list(viewer, "en", 12);
    const smallJa = await list(viewer, "ja", 12);
    const smallGuest = await list(null, "en", 12);
    const smallDetail = await detail(viewer, "ja", smallEn.items[0].id);
    const smallSection = await section(viewer, "ja");
    t("small data: the list is populated", smallEn.items.length === 5 && smallEn.total === 5, `${smallEn.items.length}/${smallEn.total}`);

    await populate(80, { userId: user.id, tmId: me.id });
    const bigEn = await list(viewer, "en", 12);
    const bigJa = await list(viewer, "ja", 12);
    const bigMax = await list(viewer, "ja", KNOWLEDGE_LIST_MAX_LIMIT);
    const bigGuest = await list(null, "en", 12);
    const bigDetail = await detail(viewer, "ja", bigEn.items[0].id);
    const bigSection = await section(viewer, "ja");
    const bigFiltered = await list(viewer, "ja", 12, { q: `${MARK} doc`, category: "DATASET" });

    t("big data: a page is capped at the limit, the true total is reported", bigEn.items.length === 12 && bigEn.total === 85 && bigMax.items.length === KNOWLEDGE_LIST_MAX_LIMIT && bigMax.total === 85, `${bigEn.items.length}/${bigEn.total}/${bigMax.items.length}`);
    t("English list: exactly 2 database operations (rows + count), whatever the data", smallEn.ops.length === 2 && bigEn.ops.length === 2, `${smallEn.ops.join(",")} | ${bigEn.ops.join(",")}`);
    t("English list: nothing is looked up per document (small == big)", smallEn.ops.length === bigEn.ops.length);
    t("Japanese list adds only batched translation lookups: document, project, area, group (4), identical for 5 and 85 rows and for 12 and 50 per page", smallJa.ops.length === bigJa.ops.length && bigJa.ops.length === bigMax.ops.length && bigJa.ops.length - bigEn.ops.length <= 4, `${smallJa.ops.length} / ${bigJa.ops.length} / ${bigMax.ops.length}`);
    t("guest list costs the same as a member list", smallGuest.ops.length === bigGuest.ops.length && bigGuest.ops.length === 2);
    t("detail: one row + at most 4 batched translation lookups, whatever the data", smallDetail.ops.length === bigDetail.ops.length && bigDetail.ops.length <= 5, `${smallDetail.ops.length}/${bigDetail.ops.length}: ${bigDetail.ops.join(",")}`);
    t("research-page/workspace section: bounded rows + count + at most 4 translation lookups", smallSection.ops.length === bigSection.ops.length && bigSection.ops.length <= 6 && bigSection.s.items.length === KNOWLEDGE_SECTION_LIMIT && bigSection.s.total >= 85, `${bigSection.ops.join(",")} ${bigSection.s.items.length}/${bigSection.s.total}`);
    // "ZZ KnowCost doc" is THREE words: the Japanese-override match is one Translation query per WORD (the search helper's
    // documented cost), so 3 + rows + count + 4 batched lookups = 9, and it does not depend on how many rows there are.
    const bigFilteredMax = await list(viewer, "ja", KNOWLEDGE_LIST_MAX_LIMIT, { q: `${MARK} doc`, category: "DATASET" });
    t("a text + category filtered list costs one override query per search WORD plus the fixed list cost (not per row)", bigFiltered.ops.length === 9 && bigFilteredMax.ops.length === 9 && bigFiltered.items.length === 12 && bigFilteredMax.items.length === KNOWLEDGE_LIST_MAX_LIMIT, `${bigFiltered.ops.length}/${bigFilteredMax.ops.length}: ${bigFiltered.ops.join(",")}`);
    t("only reads, and only the models the knowledge base may read", [...bigEn.ops, ...bigJa.ops, ...bigDetail.ops, ...bigSection.ops, ...bigFiltered.ops, ...bigFilteredMax.ops].every((o) => /^(KnowledgeDoc|Translation)\.(findMany|findFirst|count)$/.test(o)), [...new Set([...bigJa.ops, ...bigFiltered.ops])].join());
    const again = await list(viewer, "ja", 12);
    t("two identical reads return byte-identical JSON (deterministic order)", JSON.stringify(again.items) === JSON.stringify(bigJa.items));
    t("no row of another visibility class leaks into a guest list", bigGuest.items.length === 12 && bigGuest.total === (await prisma.knowledgeDoc.count({ where: { title: { startsWith: MARK }, visibility: "PUBLIC" } })) + (await prisma.knowledgeDoc.count({ where: { visibility: "PUBLIC", NOT: { title: { startsWith: MARK } } } })));
  } finally {
    await cleanup();
  }
  console.log(`${ok} knowledge query-cost checks passed, ${failures.length} failed.`);
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

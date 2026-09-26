/**
 * Proves the workspace issues a BOUNDED, DATA-INDEPENDENT number of database operations (no N+1: nothing
 * is fetched per project, group, publication, event, news item or collaborator) and never returns more rows
 * than its caps. It inserts throw-away rows, so run it ONLY against a COPY of the database:
 *   DATABASE_URL=file:C:/abs/copy.db tsx scripts/workspace-queries.test.ts
 */
import { WORKSPACE_LIMITS } from "@scl/shared";
import { prisma } from "../src/lib/prisma.js";
import { loadWorkspace } from "../src/lib/workspace.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));

let ops: string[] = [];
prisma.$use((params, next) => {
  ops.push(`${params.model}.${params.action}`);
  return next(params);
});
const run = async (viewer: { id: string; role: "MEMBER" | "LAB_MANAGER" }, locale: "en" | "ja") => {
  ops = [];
  const res = await loadWorkspace(viewer, locale);
  return { res, ops: [...ops] };
};

const MARK = "ZZ WsCost";
async function cleanup() {
  await prisma.translation.deleteMany({ where: { value: { startsWith: MARK } } });
  await prisma.event.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.newsItem.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.publication.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "wscost-" } } });
}

async function populate(n: { projects: number; groups: number; areas: number; pubs: number; events: number; news: number; people: number }, me: string) {
  const areas = [];
  for (let i = 0; i < n.areas; i++) areas.push(await prisma.researchArea.create({ data: { title: `${MARK} area ${i}`, description: "d", tag: "z", visibility: "PUBLIC" } }));
  const groups = [];
  for (let i = 0; i < n.groups; i++) groups.push(await prisma.researchGroup.create({ data: { slug: `zz-wscost-g-${i}-${Date.now()}`, name: `${MARK} group ${i}`, visibility: "LAB_ONLY" } }));
  const people = [];
  for (let i = 0; i < n.people; i++) people.push(await prisma.teamMember.create({ data: { name: `${MARK} person ${i}`, initials: "ZZ", role: "R", category: "RESEARCH" } }));
  const projects = [];
  for (let i = 0; i < n.projects; i++) {
    projects.push(await prisma.researchProject.create({ data: { slug: `zz-wscost-p-${i}-${Date.now()}`, title: `${MARK} project ${i}`, visibility: "LAB_ONLY", groupId: groups[i % Math.max(1, groups.length)]?.id ?? null } }));
  }
  await prisma.projectMember.createMany({ data: projects.map((p) => ({ projectId: p.id, teamMemberId: me, role: "MEMBER" })) });
  await prisma.projectMember.createMany({ data: projects.flatMap((p, i) => (i === 0 ? people : people.slice(0, 5)).map((c, j) => ({ projectId: p.id, teamMemberId: c.id, role: i % 3 === 0 && j === 0 ? "LEAD" : "MEMBER" }))) });
  await prisma.projectArea.createMany({ data: projects.flatMap((p, i) => (areas.length ? [{ projectId: p.id, researchAreaId: areas[i % areas.length].id }] : [])) });
  await prisma.groupMember.createMany({ data: groups.map((g) => ({ groupId: g.id, teamMemberId: me, role: "MEMBER" })) });
  await prisma.researcherArea.createMany({ data: areas.map((a) => ({ teamMemberId: me, researchAreaId: a.id })) });
  for (let i = 0; i < n.pubs; i++) {
    const p = await prisma.publication.create({ data: { year: 2000 + (i % 30), title: `${MARK} pub ${i}`, authors: "a", venue: "v", visibility: "LAB_ONLY" } });
    await prisma.publicationAuthor.create({ data: { publicationId: p.id, teamMemberId: me } });
    if (projects.length) await prisma.projectPublication.create({ data: { projectId: projects[i % projects.length].id, publicationId: p.id } });
  }
  const starts = new Date(Date.now() + 86_400_000);
  for (let i = 0; i < n.events; i++) await prisma.event.create({ data: { title: `${MARK} event ${i}`, visibility: "LAB_ONLY", startsAt: new Date(starts.getTime() + i * 3600_000), projectId: projects[i % Math.max(1, projects.length)]?.id ?? null } });
  for (let i = 0; i < n.news; i++) await prisma.newsItem.create({ data: { title: `${MARK} news ${i}`, description: "d", dateLabel: "x", sortDate: `2031-01-${String(1 + (i % 28)).padStart(2, "0")}`, type: "Update", visibility: "LAB_ONLY", projectId: projects[i % Math.max(1, projects.length)]?.id ?? null } });
  // Japanese overrides for a few, so the ja path does its batched lookups.
  for (const p of projects.slice(0, 3)) await prisma.translation.create({ data: { entityType: "RESEARCH_PROJECT", entityId: p.id, locale: "ja", field: "title", value: `${MARK} 日本語 ${p.id}` } });
  return { projects, groups, areas, people };
}

async function main() {
  await cleanup();
  const user = await prisma.user.create({ data: { email: "wscost-a@example.test", passwordHash: "x", role: "MEMBER" } });
  const me = await prisma.teamMember.create({ data: { name: `${MARK} me`, initials: "ZM", role: "R", category: "RESEARCH", userId: user.id } });
  const viewer = { id: user.id, role: "MEMBER" as const };
  try {
    await populate({ projects: 3, groups: 2, areas: 2, pubs: 3, events: 3, news: 3, people: 6 }, me.id);
    const small = await run(viewer, "en");
    const smallJa = await run(viewer, "ja");
    t("small data: the workspace is populated", small.res.projects.total === 3 && small.res.collaborators.total >= 5, `${small.res.projects.total}/${small.res.collaborators.total}`);

    await populate({ projects: 30, groups: 20, areas: 15, pubs: 60, events: 40, news: 40, people: 220 }, me.id);
    const big = await run(viewer, "en");
    const bigJa = await run(viewer, "ja");
    const L = WORKSPACE_LIMITS;
    t("big data: every section is capped and the true totals are reported", big.res.projects.items.length === L.projects && big.res.projects.total === 33 && big.res.groups.items.length === L.groups && big.res.groups.total === 22 && big.res.areas.items.length === L.areas && big.res.publications.items.length === L.publications && big.res.publications.total === 63 && big.res.events.items.length === L.events && big.res.news.items.length === L.news && big.res.collaborators.items.length === L.collaborators && big.res.collaborators.total === 226, JSON.stringify({ p: big.res.projects.total, g: big.res.groups.total, pub: big.res.publications.total, c: big.res.collaborators.total }));
    t("query count does NOT grow with the data (small vs 10x data: identical)", big.ops.length === small.ops.length, `${small.ops.length} vs ${big.ops.length}`);
    t("English: at most 17 database operations", big.ops.length <= 17, `${big.ops.length}: ${big.ops.join(",")}`);
    t("Japanese adds only batched translation lookups (one per entity type, never per row), still identical between small and big", bigJa.ops.length === smallJa.ops.length && bigJa.ops.length - big.ops.length <= 8 && bigJa.ops.length <= 25, `${smallJa.ops.length} vs ${bigJa.ops.length} (en ${big.ops.length})`);
    t("no operation targets a model the workspace must not read (User, Session, AuditLog, Message, Notification, StoredFile ...)", [...big.ops, ...bigJa.ops].every((o) => /^(TeamMember|ProjectMember|GroupMember|ResearchArea|ResearcherArea|Publication|Event|NewsItem|Translation)\./.test(o)), [...new Set([...big.ops, ...bigJa.ops])].join());
    t("only reads: findUnique / findMany / count", [...big.ops, ...bigJa.ops].every((o) => /\.(findUnique|findMany|count)$/.test(o)));
    const again = await run(viewer, "en");
    t("two identical reads return byte-identical JSON (deterministic order)", JSON.stringify(again.res) === JSON.stringify(big.res));
  } finally {
    await cleanup();
  }
  console.log(`${ok} workspace query-cost checks passed, ${failures.length} failed.`);
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

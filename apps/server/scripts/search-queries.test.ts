/**
 * Proves search issues a BOUNDED number of database operations, however many results a page holds
 * (no N+1: nothing is fetched per result), and that it never loads more rows than it returns.
 *
 * It inserts 240 throw-away publications, so run it ONLY against a COPY of the database:
 *   DATABASE_URL=file:/abs/copy.db tsx scripts/search-queries.test.ts
 */
import { searchQuerySchema } from "@scl/shared";
import { prisma } from "../src/lib/prisma.js";
import { runSearch } from "../src/lib/search.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));

let ops: string[] = [];
prisma.$use((params, next) => {
  ops.push(`${params.model}.${params.action}`);
  return next(params);
});
const run = async (viewer: { id: string; role: "MEMBER" } | null, raw: Record<string, string>) => {
  ops = [];
  const res = await runSearch(viewer, searchQuerySchema.parse(raw));
  return { res, ops: [...ops] };
};

const MARK = "ZZ Query Count";
async function main() {
  await prisma.publication.deleteMany({ where: { title: { startsWith: MARK } } });
  await prisma.publication.createMany({
    data: Array.from({ length: 240 }, (_, i) => ({ year: 2000 + (i % 40), title: `${MARK} ${String(i).padStart(3, "0")}`, authors: "a", venue: "v", visibility: i % 2 ? "PUBLIC" : "LAB_ONLY" })),
  });
  try {
    const member = { id: "someone", role: "MEMBER" as const };
    const many = await run(member, { q: MARK, limit: "50" });
    t("240 matches, 50 returned", many.res.results.length === 50 && many.res.pagination.total === 240);
    t("50 results cost at most 13 database operations (12 before Phase 22 added the knowledge COUNT; not 50+)", many.ops.length <= 13, `${many.ops.length}: ${many.ops.join(",")}`);
    const one = await run(member, { q: MARK, limit: "1" });
    t("1 result costs the same order of operations as 50", one.res.results.length === 1 && Math.abs(many.ops.length - one.ops.length) <= 2, `${one.ops.length} vs ${many.ops.length}`);
    t("only COUNT and one findMany per overlapping bucket, nothing else", many.ops.every((o) => /\.(count|findMany)$/.test(o)) && many.ops.filter((o) => o.endsWith(".findMany")).length <= 3);
    t("no operation targets a model that is not searched (User, Session, AuditLog, ...)", many.ops.every((o) => /^(ResearchArea|ResearchProject|ResearchGroup|TeamMember|Publication|NewsItem|ForumPost|ForumCategory|Event|KnowledgeDoc)\./.test(o)));

    const guest = await run(null, { q: MARK, limit: "50" });
    t("guest sees only the 120 PUBLIC rows, with the same bounded cost", guest.res.pagination.total === 120 && guest.res.counts.publication === 120 && guest.ops.length <= 13, `${guest.res.pagination.total} ops ${guest.ops.length}`);
    const deep = await run(member, { q: MARK, limit: "50", page: "5" });
    t("deep page (offset 200): the remaining 40, still bounded", deep.res.results.length === 40 && deep.ops.length <= 13);
    const none = await run(null, { q: "zzzznomatchzzzz", limit: "50" });
    t("no matches: only the 9 per-type COUNTs run (no tier counts, no SELECT)", none.ops.length === 9 && none.ops.every((o) => o.endsWith(".count")), none.ops.join());
    const typed = await run(null, { q: MARK, type: "publication", limit: "20" });
    t("type filter still counts every type (chips) but reads rows of one type only", typed.ops.filter((o) => o.endsWith(".findMany")).every((o) => o === "Publication.findMany"));
    const allTypes = await run(member, { q: "a", limit: "50" });
    t("worst case (every type, many words matching): at most 6 + 12 counts + 18 selects", allTypes.ops.length <= 36, String(allTypes.ops.length));
  } finally {
    await prisma.publication.deleteMany({ where: { title: { startsWith: MARK } } });
  }
  console.log(`${ok} search query-cost checks passed, ${failures.length} failed.`);
  for (const f of failures) console.log("  FAIL", f);
  process.exitCode = failures.length ? 1 : 0;
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());

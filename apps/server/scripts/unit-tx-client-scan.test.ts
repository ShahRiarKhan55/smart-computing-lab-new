/**
 * Static guard for a bug class that has now been found three times (knowledge links, admin translations, then resources and events):
 * a query on the SHARED Prisma client issued from inside `prisma.$transaction(async (tx) => ...)` waits for the connection (and, with the
 * libsql adapter, the mutex) that the transaction itself holds, until Prisma's 5 s timeout, then answers 500 (P2028). It works whenever the
 * pool happens to have a second connection, so ordinary tests do not see it; `scripts/transaction-client-regression.ts` shows it at runtime
 * with `connection_limit=1`, and this test finds it WITHOUT running anything.
 *
 * For every `$transaction` callback in src/ it reports
 *   - DIRECT:   the global `prisma` identifier used inside the callback;
 *   - INDIRECT: a call to a function that uses the global `prisma` and is not handed the transaction client as an argument.
 * Limits (deliberate): functions are matched by NAME across all of src/ (a homonym can cause a false alarm, never a miss), and a helper that
 * receives `tx` is trusted to use it. The scanner is itself tested below on synthetic sources, so a broken scanner cannot pass silently.
 *
 *   npm run test:unit -w apps/server
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? " :: " + detail : "")));

/** An identifier named `prisma` that REFERS to the shared client: not `x.prisma`, not an object key `{ prisma: 1 }`, not an import specifier. */
const isGlobalRef = (n: ts.Node): boolean =>
  ts.isIdentifier(n) &&
  n.text === "prisma" &&
  !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) &&
  !(ts.isPropertyAssignment(n.parent) && n.parent.name === n) &&
  !ts.isImportSpecifier(n.parent);

/** Pure: sources by file name in, findings out. */
export function scanTransactions(sources: Map<string, string>): string[] {
  const parsed = new Map([...sources].map(([f, text]) => [f, ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true)]));
  const usesGlobal = (node: ts.Node) => {
    let found = false;
    (function visit(n: ts.Node) {
      if (found) return;
      if (isGlobalRef(n)) found = true;
      else ts.forEachChild(n, visit);
    })(node);
    return found;
  };
  const fnName = (n: ts.Node): string | null => {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.name.text;
    return null;
  };
  // Helpers that reach for the global client. A helper that takes the client as a parameter (`db`) does not mention `prisma` in its body.
  const globalFns = new Map<string, string>();
  for (const [file, sf] of parsed) {
    (function visit(n: ts.Node) {
      const name = fnName(n);
      if (name && usesGlobal(ts.isVariableDeclaration(n) ? n.initializer! : n)) globalFns.set(name, (globalFns.get(name) ? globalFns.get(name) + ", " : "") + file);
      ts.forEachChild(n, visit);
    })(sf);
  }
  const out: string[] = [];
  for (const [file, sf] of parsed) {
    (function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "$transaction" && n.arguments[0] && (ts.isArrowFunction(n.arguments[0]) || ts.isFunctionExpression(n.arguments[0]))) {
        const cb = n.arguments[0];
        const txName = cb.parameters[0] && ts.isIdentifier(cb.parameters[0].name) ? cb.parameters[0].name.text : "tx";
        (function walk(m: ts.Node) {
          const where = () => `${file}:${sf.getLineAndCharacterOfPosition(m.getStart()).line + 1}`;
          if (isGlobalRef(m)) out.push(`DIRECT   ${where()} global prisma used inside a transaction callback`);
          if (ts.isCallExpression(m) && ts.isIdentifier(m.expression) && globalFns.has(m.expression.text) && !m.arguments.some((a) => ts.isIdentifier(a) && a.text === txName)) {
            out.push(`INDIRECT ${where()} ${m.expression.text}(...) uses the global prisma (${globalFns.get(m.expression.text)}) and is not given ${txName}`);
          }
          ts.forEachChild(m, walk);
        })(cb.body);
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  return out;
}

// ---- the scanner works (synthetic sources) -----------------------------------------------------------------------------------------
const src = (body: string) => new Map([["x.ts", body]]);
const helper = `import { prisma } from "./p"; async function check(id: string) { return prisma.thing.findUnique({ where: { id } }); }\n`;
const safeHelper = `async function check(db: any, id: string) { return db.thing.findUnique({ where: { id } }); }\n`;
t("scanner: a direct global query inside a transaction is reported", scanTransactions(src(`import { prisma } from "./p"; prisma.$transaction(async (tx) => { await prisma.a.findMany(); });`)).some((f) => f.startsWith("DIRECT")));
t("scanner: a global-client helper called inside a transaction without tx is reported", scanTransactions(src(helper + `prisma.$transaction(async (tx) => { await check("1"); });`)).some((f) => f.startsWith("INDIRECT") && f.includes("check(")));
t("scanner: the same helper handed tx is NOT reported", scanTransactions(src(helper + `prisma.$transaction(async (tx) => { await check(tx, "1"); });`)).length === 0);
t("scanner: a helper that takes the client as a parameter is NOT reported", scanTransactions(src(safeHelper + `prisma.$transaction(async (tx) => { await check(tx, "1"); });`)).length === 0);
t("scanner: the global helper used OUTSIDE a transaction is fine", scanTransactions(src(helper + `async function route() { await check("1"); }`)).length === 0);
t("scanner: tx queries and a renamed transaction parameter are fine", scanTransactions(src(`import { prisma } from "./p"; prisma.$transaction(async (db) => { await db.a.findMany(); });`)).length === 0);
t("scanner: a property named prisma is not the global client", scanTransactions(src(`prisma.$transaction(async (tx) => { await tx.x.update({ data: { prisma: 1 } }); const o = { prisma: 2 }; o.prisma; });`)).length === 0);

// ---- the repository itself ------------------------------------------------------------------------------------------------------
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = new Map<string, string>();
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith(".ts")) files.set(path.relative(SRC, p), fs.readFileSync(p, "utf8"));
  }
})(SRC);
t("repository: the scan really covered the server sources", files.size > 40 && [...files.keys()].some((f) => f.endsWith("resources.routes.ts")) && [...files.keys()].some((f) => f.endsWith("events.routes.ts")));
const findings = scanTransactions(files);
t("repository: no $transaction callback queries through the shared client (directly or via a helper)", findings.length === 0, findings.join(" | "));

console.log(`\n${ok} tx-client scan checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

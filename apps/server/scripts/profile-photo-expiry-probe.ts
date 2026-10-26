/**
 * Diagnostic: what happens when Prisma's interactive-transaction timer fires WHILE the embedded-libSQL guard's synchronous COMMIT is
 * still waiting, and the commit then succeeds? (Scaled down: timeout 1000 ms, a reader in another process holds a read lock for N ms.)
 *   npx tsx scripts/profile-photo-expiry-probe.ts            # scaled-down sweep (explicit 1 s timeout)
 *   REAL_DEFAULT=1 npx tsx scripts/profile-photo-expiry-probe.ts   # UNSCALED: Prisma's real 5 s default, guard waits widened to 8 s
 * Measured result (see docs/architecture/phase13-files-and-gallery.md): once the commit outlasts the Prisma timeout, `$transaction`
 * throws P2028 ("transaction expired") although the change IS applied. That is why the embedded write routes pass wider limits
 * (`interactiveTransactionOptions`). Disposable temp database only; refuses to run when a TURSO_ variable or DATABASE_URL is set.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";
import { guardEmbeddedLibsql } from "../src/lib/libsqlGuard.ts";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_URL) { console.error("Refusing to run: TURSO_* / DATABASE_URL is set."); process.exit(2); }
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const READER = `const { createClient } = require("@libsql/client");(async()=>{const c=createClient({url:process.argv[1]});const tx=await c.transaction("deferred");await tx.execute("SELECT * FROM TeamMember");console.log("ready");setTimeout(async()=>{await tx.rollback();process.exit(0)},Number(process.argv[2]))})()`;

async function trial(txTimeoutMs: number | undefined, holdMs: number, guardOptions?: { busyTimeoutMs: number; commitBudgetMs: number }): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scl-photo-expiry-"));
  const url = `file:${path.join(dir, "t.db")}`;
  try {
    const c = createClient({ url });
    const mig = path.join(SERVER, "prisma", "migrations");
    for (const d of fs.readdirSync(mig, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) await c.executeMultiple(fs.readFileSync(path.join(mig, d, "migration.sql"), "utf8"));
    await c.execute("INSERT INTO TeamMember (id,name,initials,role,category,department,bio,photoUrl,sortOrder,createdAt,updatedAt) VALUES ('m1','M','M','R','MSC','','B0','',0,0,0)");
    c.close();
    const prisma = new PrismaClient({ adapter: new PrismaLibSQL(guardEmbeddedLibsql(createClient({ url }), url, guardOptions)) });
    await prisma.teamMember.findFirst();
    const reader = spawn(process.execPath, ["-e", READER, url, String(holdMs)], { cwd: SERVER, stdio: ["ignore", "pipe", "inherit"] });
    const gone = new Promise((r) => reader.on("exit", r));
    await new Promise((r) => reader.stdout!.once("data", r));
    const t0 = Date.now();
    let outcome: string;
    try { await prisma.$transaction(async (tx) => { await tx.teamMember.updateMany({ where: { id: "m1" }, data: { bio: "APPLIED", updatedAt: new Date() } }); }, txTimeoutMs === undefined ? undefined : { timeout: txTimeoutMs, maxWait: 2000 }); outcome = "returned OK"; }
    catch (e) { outcome = `threw ${(e as { code?: string }).code ?? (e as Error).name}`; }
    const ms = Date.now() - t0;
    await gone;
    await new Promise((r) => setTimeout(r, 300));
    const c2 = createClient({ url });
    const bio = String((await c2.execute("SELECT bio FROM TeamMember WHERE id='m1'")).rows[0].bio);
    c2.close();
    await prisma.$disconnect();
    const verdict = outcome.startsWith("returned") ? (bio === "APPLIED" ? "consistent (applied)" : "MISMATCH") : bio === "APPLIED" ? "APPLIED DESPITE ERROR (uncertain outcome)" : "not applied (consistent)";
    return `Prisma timeout ${txTimeoutMs ?? "5000 (the REAL default, no option passed)"} ms, lock held ${holdMs} ms: $transaction ${outcome} after ${ms} ms; row ${bio} => ${verdict}`;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (process.env.REAL_DEFAULT === "1") {
  // Unscaled: Prisma's actual default (5 s) with the guard's waits deliberately widened to 8 s so that a commit CAN outlast it
  // (the shipped guard gives up after 2 s and can never reach this window).
  const wide = { busyTimeoutMs: 8000, commitBudgetMs: 8000 };
  for (const hold of [3000, 5500, 6500, 9000]) console.log(await trial(undefined, hold, wide));
  process.exit(0);
}
for (const hold of [500, 1200, 1900, 2500]) console.log(await trial(1000, hold));
console.log(await trial(15000, 1900)); // the embedded write routes' real limit: no expiry for any wait the guard allows
process.exit(0);

/**
 * Tests of the embedded-libSQL lifecycle guard (src/lib/libsqlGuard.ts): pure logic with fake transactions, plus a deterministic
 * two-process check against a disposable embedded database file in a temp directory (no network, no credentials).
 *   npx tsx scripts/unit-libsql-guard.test.ts
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { EMBEDDED_BUSY_TIMEOUT_MS, EMBEDDED_COMMIT_BUDGET_MS, EMBEDDED_TRANSACTION_OPTIONS, commitGuarded, guardEmbeddedLibsql, interactiveTransactionOptionsFor, isBusyError, isEmbeddedLibsqlUrl } from "../src/lib/libsqlGuard.ts";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error("Refusing to run: Turso variables are set.");
  process.exit(2);
}
let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(detail ? `${name} :: ${detail}` : name));

const busy = () => Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY", rawCode: 5 });
const fakeTx = (commitResults: Array<"ok" | "busy" | "other">) => {
  const calls: string[] = [];
  let open = true;
  const tx = {
    get closed() { return !open; },
    async executeMultiple(sql: string) {
      calls.push(sql);
      if (sql.startsWith("PRAGMA")) return;
      const next = commitResults.shift() ?? "ok";
      if (next === "busy") throw busy();
      if (next === "other") throw Object.assign(new Error("constraint"), { code: "SQLITE_CONSTRAINT" });
      open = false;
    },
    async rollback() { calls.push("ROLLBACK"); open = false; },
  };
  return { tx, calls };
};

// ---- error classification
t("isBusyError: code", isBusyError(busy()));
t("isBusyError: rawCode 5 only", isBusyError({ rawCode: 5 }));
t("isBusyError: message text", isBusyError(new Error("database is locked")));
t("isBusyError: other errors and non-errors are not busy", !isBusyError(new Error("constraint")) && !isBusyError(null) && !isBusyError("x") && !isBusyError({ code: "SQLITE_CONSTRAINT" }));
t("isEmbeddedLibsqlUrl: file: yes; libsql://, https://, wss:// no", isEmbeddedLibsqlUrl("file:/tmp/x.db") && isEmbeddedLibsqlUrl(" FILE:./x.db") && !isEmbeddedLibsqlUrl("libsql://db.turso.io") && !isEmbeddedLibsqlUrl("https://db.turso.io") && !isEmbeddedLibsqlUrl("wss://db.turso.io"));

// ---- commitGuarded with fake transactions
{
  const { tx, calls } = fakeTx(["ok"]);
  await commitGuarded(tx, 500);
  t("a COMMIT that succeeds is sent once through the exec path and nothing else happens", JSON.stringify(calls) === JSON.stringify(["COMMIT"]));
}
{
  const { tx, calls } = fakeTx(["busy", "busy", "ok"]);
  const slowExec = tx.executeMultiple.bind(tx);
  tx.executeMultiple = async (sql: string) => { if (sql === "COMMIT") await new Promise((r) => setTimeout(r, 120)); return slowExec(sql); }; // each COMMIT attempt takes time
  await commitGuarded(tx, 2000);
  const commits = calls.filter((c) => c === "COMMIT").length;
  const pragmas = calls.filter((c) => /^PRAGMA busy_timeout = \d+$/.test(c));
  t("a BUSY COMMIT is re-issued on the SAME transaction until it succeeds, with no rollback", commits === 3 && !calls.includes("ROLLBACK") && calls[calls.length - 1] === "COMMIT");
  t("each RE-issued COMMIT may wait only for what is left of the budget (never a full timeout again)", pragmas.length === 2 && Number(pragmas[1].split("= ")[1]) < Number(pragmas[0].split("= ")[1]) && Number(pragmas[0].split("= ")[1]) < 2000 && Number(pragmas[1].split("= ")[1]) >= 1, JSON.stringify(pragmas));
}
{
  const { tx, calls } = fakeTx(["other"]);
  const err = await commitGuarded(tx, 500).then(() => null, (e) => e);
  t("a non-BUSY COMMIT failure is NOT retried: it is rolled back once and rethrown unchanged", err?.code === "SQLITE_CONSTRAINT" && JSON.stringify(calls) === JSON.stringify(["COMMIT", "ROLLBACK"]));
}
{
  const { tx, calls } = fakeTx(Array(1000).fill("busy"));
  const started = Date.now();
  const err = await commitGuarded(tx, 150).then(() => null, (e) => e);
  t("a COMMIT that stays BUSY is retried only within its budget, then rolled back once and the BUSY error is rethrown", err?.code === "SQLITE_BUSY" && calls[calls.length - 1] === "ROLLBACK" && calls.filter((c) => c === "ROLLBACK").length === 1 && calls.length >= 3 && Date.now() - started < 1500, JSON.stringify(calls.slice(-2)));
}
{
  const { tx, calls } = fakeTx(["busy"]);
  await tx.rollback(); // the transaction is already closed
  calls.length = 0;
  const err = await commitGuarded(tx, 500).then(() => null, (e) => e);
  t("a closed transaction is never retried or rolled back again", err?.code === "SQLITE_BUSY" && JSON.stringify(calls) === JSON.stringify(["COMMIT"]));
}

// ---- Prisma transaction limits for embedded databases
t("embedded: the transaction timeout comfortably exceeds the worst blocking path (first write + commit, twice over for margin) and maxWait covers a stalled predecessor", EMBEDDED_TRANSACTION_OPTIONS.timeout >= 2 * (EMBEDDED_BUSY_TIMEOUT_MS + EMBEDDED_COMMIT_BUDGET_MS) + 5000 && EMBEDDED_TRANSACTION_OPTIONS.maxWait >= EMBEDDED_BUSY_TIMEOUT_MS + EMBEDDED_COMMIT_BUDGET_MS);
t("transaction options: a file: URL gets the wider limits", JSON.stringify(interactiveTransactionOptionsFor("file:/tmp/x.db")) === JSON.stringify(EMBEDDED_TRANSACTION_OPTIONS));
t("transaction options: remote URLs and no URL keep Prisma's defaults (undefined)", interactiveTransactionOptionsFor("libsql://db.turso.io") === undefined && interactiveTransactionOptionsFor("https://db.turso.io") === undefined && interactiveTransactionOptionsFor(undefined) === undefined && interactiveTransactionOptionsFor("") === undefined);

// ---- wrapper wiring
{
  const remote: any = { marker: "remote" };
  t("a remote (non-file:) client is returned UNTOUCHED", guardEmbeddedLibsql(remote, "libsql://example.invalid") === remote && guardEmbeddedLibsql(remote, "https://example.invalid") === remote);
}

// ---- real embedded database, two processes, deterministic COMMIT-vs-reader collision
const work = fs.mkdtempSync(path.join(os.tmpdir(), "scl-libsql-guard-"));
const url = `file:${path.join(work, "t.db")}`;
{
  const c = createClient({ url });
  await c.execute("CREATE TABLE t (a INTEGER)");
  await c.execute("INSERT INTO t VALUES (1)");
  c.close();
}
const READER = `const { createClient } = require("@libsql/client");(async()=>{const c=createClient({url:process.argv[1]});const tx=await c.transaction("deferred");await tx.execute("SELECT * FROM t");console.log("ready");setTimeout(async()=>{await tx.rollback();process.exit(0)},Number(process.argv[2]))})()`;
const PROBE = `const { createClient } = require("@libsql/client");(async()=>{const c=createClient({url:process.argv[1]});try{await c.execute("BEGIN IMMEDIATE");await c.execute("UPDATE t SET a=a+1");await c.execute("COMMIT");console.log("free")}catch(e){console.log("LOCKED("+e.code+")")}process.exit(0)})()`;
const SERVER = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const probe = () => execFileSync(process.execPath, ["-e", PROBE, url], { cwd: SERVER, encoding: "utf8" }).trim();
async function collide(guarded: boolean, holdMs: number) {
  let client = createClient({ url });
  if (guarded) client = guardEmbeddedLibsql(client, url);
  const tx = await client.transaction("deferred");
  await tx.execute("UPDATE t SET a = a + 10"); // this transaction holds the write lock
  const reader = spawn(process.execPath, ["-e", READER, url, String(holdMs)], { cwd: SERVER, stdio: ["ignore", "pipe", "inherit"] }); // ANOTHER PROCESS holds a read lock
  const readerGone = new Promise((r) => reader.on("exit", r)); // attached at once, so a fast exit cannot be missed
  await Promise.race([new Promise((r) => reader.stdout.once("data", r)), readerGone]); // a reader that dies early cannot hang the test
  const t0 = Date.now();
  let result = "ok";
  try { await tx.commit(); } catch (e) { result = (e as { code?: string }).code ?? "error"; try { await tx.rollback(); } catch { /* ignore */ } }
  const waited = Date.now() - t0;
  await readerGone;
  const after = probe();
  client.close();
  return { result, waited, after };
}
{
  const g = await collide(true, 300);
  t("GUARDED: a COMMIT that meets another process's short read lock waits and SUCCEEDS", g.result === "ok" && g.waited >= 250 && g.waited < EMBEDDED_BUSY_TIMEOUT_MS + 1000, JSON.stringify(g));
  t("GUARDED: and no lock is left behind afterwards", g.after === "free", JSON.stringify(g));
}
{
  const g = await collide(true, EMBEDDED_BUSY_TIMEOUT_MS + 1500);
  t("GUARDED: a COMMIT that outlasts its budget fails with SQLITE_BUSY after a bounded wait", g.result === "SQLITE_BUSY" && g.waited < EMBEDDED_BUSY_TIMEOUT_MS * 3, JSON.stringify(g));
  t("GUARDED: and the lock is released once it has been rolled back (the process recovers)", g.after === "free", JSON.stringify(g));
}
{
  const u = await collide(false, 300);
  // Characterization of the UNGUARDED client (informational: if the library is fixed upstream this may change and the guard can go).
  console.log(`characterization (not a check): unguarded client => commit ${u.result} after ${u.waited}ms; lock afterwards ${u.after}`);
}
fs.rmSync(work, { recursive: true, force: true });
console.log(`${ok} libsql-guard unit checks passed, ${failures.length} failed.`);
for (const f of failures) console.log(" - " + f);
process.exit(failures.length ? 1 : 0);

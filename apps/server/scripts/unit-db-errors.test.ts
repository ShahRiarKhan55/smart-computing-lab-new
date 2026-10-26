/**
 * Unit test of lib/dbErrors.ts: constraint classification for local SQLite (typed P2002/P2003) and for the untyped
 * `SQLITE_CONSTRAINT` shape that Turso/libSQL produces with Prisma 5.22 + @prisma/adapter-libsql 5.22 (Phase 2.2.3).
 * The "engine-shaped" cases run the REAL installed Prisma engine and adapter against an IN-MEMORY libsql client whose
 * errors have their numeric `rawCode` stripped (what a remote driver error looks like). No file, no network, no hosted
 * database.   npm run test:unit -w apps/server
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { LibsqlError } from "@libsql/client";
import { SERVICE_BUSY_MESSAGE, constraintKind, isTransientDatabaseContention, mapKnownDatabaseError, transientContentionAs503 } from "../src/lib/dbErrors.ts";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

const known = (code: string, message = "boom", meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "5.22.0", meta });
const frame = (driverText: string) => `\nInvalid \`prisma.x.create()\` invocation in /app/src/y.ts:12:3\n\n  11 // a comment mentioning UNIQUE constraint failed and FOREIGN KEY constraint failed\n→ 12 await prisma.x.create(\n${driverText}`;

// ---- transient lock contention (503, never retried by the server) -------------------------------------------------------------
const unknownReq = (message: string) => new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: "5.22.0" });
t("contention: Prisma timeout P1008 is NOT classified (a remote timed-out commit may have been applied)", !isTransientDatabaseContention(known("P1008", frame("Operations timed out after `N/A`. Context: The database failed to respond"))));
t("contention: driver code SQLITE_BUSY", isTransientDatabaseContention(known("SQLITE_BUSY", frame("SQLITE_BUSY: database is locked"))));
t("contention: extended SQLITE_BUSY_SNAPSHOT", isTransientDatabaseContention(known("SQLITE_BUSY_SNAPSHOT")));
t("contention: unknown-request error whose final line is the driver's BUSY text", isTransientDatabaseContention(unknownReq(frame("SQLITE_BUSY: database is locked"))));
t("contention: a generic query timeout is NOT classified", !isTransientDatabaseContention(unknownReq(frame("ConnectorError { kind: ConnectionError(Timed out during query execution.) }"))));
t("contention: 'database is locked' as the last driver line of a known error", isTransientDatabaseContention(known("P2010", frame("database is locked"))));
t("contention: NOT detected from the code frame (a comment mentioning 'database is locked' above an unrelated error)", !isTransientDatabaseContention(known("P2002", `\n  11 // database is locked\n→ 12 await prisma.x.create(\nUNIQUE constraint failed: X.y`)));
t("contention: the embedded libSQL client's own SQLITE_BUSY error (a commit that stayed BUSY after the guard's rollback)", isTransientDatabaseContention(new LibsqlError("SQLITE_BUSY: database is locked", "SQLITE_BUSY", 5)));
t("contention: other libSQL client errors are not contention", !isTransientDatabaseContention(new LibsqlError("constraint", "SQLITE_CONSTRAINT")) && !isTransientDatabaseContention(new LibsqlError("closed", "TRANSACTION_CLOSED")) && !isTransientDatabaseContention(new LibsqlError("x", "SQLITE_LOCKED")));
t("contention: NOT detected from the code frame of an UNKNOWN-request error either", !isTransientDatabaseContention(unknownReq(`\n  11 // SQLITE_BUSY database is locked\n→ 12 await prisma.x.create(\nsome other failure`)));
t("contention: constraint failures, not-found and plain errors are not contention", !isTransientDatabaseContention(known("P2002")) && !isTransientDatabaseContention(known("P2025")) && !isTransientDatabaseContention(known("SQLITE_CONSTRAINT", frame("UNIQUE constraint failed: A.b"))) && !isTransientDatabaseContention(new Error("database is locked")) && !isTransientDatabaseContention(null));
t("contention is NOT part of the 4xx mapping (it never changes the existing contract)", mapKnownDatabaseError(known("P1008")) === null && mapKnownDatabaseError(known("SQLITE_BUSY")) === null);
t("the busy message is the fixed, client-safe sentence", SERVICE_BUSY_MESSAGE === "The service is busy. Please try again in a moment.");

// ---- classification ----------------------------------------------------------------------------------------------------
t("P2002 -> unique", constraintKind(known("P2002")) === "unique");
t("P2003 -> foreign_key", constraintKind(known("P2003")) === "foreign_key");
t("P2025 is not a constraint failure", constraintKind(known("P2025")) === null);
t("extended SQLITE_CONSTRAINT_UNIQUE -> unique", constraintKind(known("SQLITE_CONSTRAINT_UNIQUE")) === "unique");
t("extended SQLITE_CONSTRAINT_PRIMARYKEY -> unique", constraintKind(known("SQLITE_CONSTRAINT_PRIMARYKEY")) === "unique");
t("extended SQLITE_CONSTRAINT_FOREIGNKEY -> foreign_key", constraintKind(known("SQLITE_CONSTRAINT_FOREIGNKEY")) === "foreign_key");
t("plain SQLITE_CONSTRAINT with a UNIQUE driver line -> unique", constraintKind(known("SQLITE_CONSTRAINT", frame("UNIQUE constraint failed: OAuthIdentity.provider, OAuthIdentity.subject"))) === "unique");
t("plain SQLITE_CONSTRAINT with a FOREIGN KEY driver line -> foreign_key", constraintKind(known("SQLITE_CONSTRAINT", frame("FOREIGN KEY constraint failed"))) === "foreign_key");
t("plain SQLITE_CONSTRAINT with a NOT NULL driver line -> unknown constraint (NOT a duplicate)", constraintKind(known("SQLITE_CONSTRAINT", frame("NOT NULL constraint failed: User.email"))) === "constraint");
t("plain SQLITE_CONSTRAINT with a CHECK driver line -> unknown constraint", constraintKind(known("SQLITE_CONSTRAINT", frame("CHECK constraint failed: x"))) === "constraint");
t("plain SQLITE_CONSTRAINT with no usable text -> unknown constraint, never unique", constraintKind(known("SQLITE_CONSTRAINT", "")) === "constraint" && constraintKind(known("SQLITE_CONSTRAINT", "boom")) === "constraint");
t("words in Prisma's code frame (not the last line) do not classify", constraintKind(known("SQLITE_CONSTRAINT", frame("something else entirely"))) === "constraint");
t("a non-Prisma error with the same words is not classified", constraintKind(Object.assign(new Error("UNIQUE constraint failed: a.b"), { code: "SQLITE_CONSTRAINT" })) === null);
t("a generic Error, null, undefined and strings are not constraint failures", [new Error("x"), null, undefined, "UNIQUE constraint failed", { code: "P2002" }].every((e) => constraintKind(e) === null));
t("other Prisma codes are not constraint failures", ["P1001", "P2024", "SQLITE_BUSY", "SQLITE_IOERR"].every((c) => constraintKind(known(c)) === null));

// ---- Phase 2.2.6 hardening: a numbered Prisma code-frame line is never driver text ---------------------------------------------
const bareFrame = (lastLine: string) => `\nInvalid \`prisma.x.create()\` invocation in /app/src/y.ts:12:3\n\n  11 const a = 1;\n${lastLine}`;
t("empty driver message + code frame ending in a numbered line mentioning UNIQUE -> unknown constraint, not unique", constraintKind(known("SQLITE_CONSTRAINT", bareFrame("→ 12 // UNIQUE constraint failed (comment in source)"))) === "constraint");
t("... same trap with FOREIGN KEY", constraintKind(known("SQLITE_CONSTRAINT", bareFrame("→ 12 await x(); // FOREIGN KEY constraint failed"))) === "constraint");
t("... a numbered frame line without the arrow", constraintKind(known("SQLITE_CONSTRAINT", bareFrame("13 // UNIQUE constraint failed"))) === "constraint");
t("an entirely empty message -> unknown constraint", constraintKind(known("SQLITE_CONSTRAINT", "")) === "constraint");
t("whitespace-only message -> unknown constraint", constraintKind(known("SQLITE_CONSTRAINT", "  \n \r\n ")) === "constraint");
t("native SQLite wording is still recognised (unique)", constraintKind(known("SQLITE_CONSTRAINT", frame("UNIQUE constraint failed: OAuthIdentity.provider, OAuthIdentity.subject"))) === "unique");
t("native SQLite wording is still recognised (foreign key)", constraintKind(known("SQLITE_CONSTRAINT", frame("FOREIGN KEY constraint failed"))) === "foreign_key");
t("Windows line endings do not hide the driver line", constraintKind(known("SQLITE_CONSTRAINT", frame("UNIQUE constraint failed: A.b").replace(/\n/g, "\r\n"))) === "unique");
t("a prefix before the SQLite text is tolerated (NOT a claim about Turso's wording)", constraintKind(known("SQLITE_CONSTRAINT", frame("SQLITE_CONSTRAINT: SQLite error: UNIQUE constraint failed: A.b"))) === "unique");
t("driver text that does not begin with a digit is used even when it follows a frame", constraintKind(known("SQLITE_CONSTRAINT", frame("CHECK constraint failed: x"))) === "constraint");
t("the empty-message trap does not change the HTTP mapping: not mapped (generic 500)", mapKnownDatabaseError(known("SQLITE_CONSTRAINT", bareFrame("→ 12 // UNIQUE constraint failed"))) === null);

// ---- HTTP mapping (the long-standing contract) ---------------------------------------------------------------------------
const m = (e: unknown) => JSON.stringify(mapKnownDatabaseError(e));
t("P2002 keeps its 409 contract", m(known("P2002")) === '{"status":409,"error":"That record already exists."}');
t("P2003 keeps its 400 contract", m(known("P2003")) === '{"status":400,"error":"A referenced record does not exist."}');
t("P2025 keeps its 404 contract", m(known("P2025")) === '{"status":404,"error":"Not found"}');
t("remote unique shape -> the same 409", m(known("SQLITE_CONSTRAINT", frame("UNIQUE constraint failed: User.email"))) === m(known("P2002")));
t("remote foreign-key shape -> the same 400 (never reported as a duplicate)", m(known("SQLITE_CONSTRAINT", frame("FOREIGN KEY constraint failed"))) === m(known("P2003")));
t("remote NOT NULL / unknown constraint shapes are NOT mapped (stay a generic 500)", mapKnownDatabaseError(known("SQLITE_CONSTRAINT", frame("NOT NULL constraint failed: User.email"))) === null && mapKnownDatabaseError(known("SQLITE_CONSTRAINT", "boom")) === null);
t("generic errors are NOT mapped", mapKnownDatabaseError(new Error("db down")) === null && mapKnownDatabaseError(known("P1001")) === null && mapKnownDatabaseError(undefined) === null);

// ---- the REAL engine + adapter, remote-shaped errors ---------------------------------------------------------------------
// Uses the project's own models (User, OAuthIdentity) on an in-memory libsql client: model queries are what produce the
// observed `SQLITE_CONSTRAINT` shape, and the DDL is the project's real migration SQL.
const migDir = path.resolve(import.meta.dirname, "..", "prisma", "migrations");
const initSql = readFileSync(path.join(migDir, "20260918122941_init", "migration.sql"), "utf8");
const userDdl = [/CREATE TABLE "User" \([\s\S]*?\n\);/, /CREATE UNIQUE INDEX "User_email_key"[^\n]*;/].map((re) => initSql.match(re)![0].replace(/;$/, ""));
const oauthDdl = readFileSync(path.join(migDir, "20261012100000_oauth_identity", "migration.sql"), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").split(";").map((x) => x.trim()).filter(Boolean);
async function engine(strip: boolean) {
  const real = createClient({ url: ":memory:" });
  for (const ddl of [...userDdl, ...oauthDdl]) await real.execute(ddl);
  const client = new Proxy(real, {
    get(target, prop) {
      if (prop === "execute") {
        return async (q: unknown) => {
          try {
            return await target.execute(q as never);
          } catch (e: any) {
            if (!strip) throw e;
            // like a remote error: a string code only, NO numeric rawCode; constraint codes collapse to the plain code
            const ne = new Error(e.message);
            Object.assign(ne, { code: String(e.code ?? "").startsWith("SQLITE_CONSTRAINT") ? "SQLITE_CONSTRAINT" : e.code });
            throw ne;
          }
        };
      }
      const v = (target as any)[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return new PrismaClient({ adapter: new PrismaLibSQL(client as never) });
}
const errOf = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e; } };
const now = new Date();
for (const strip of [false, true]) {
  const label = strip ? "remote-shaped (rawCode stripped)" : "local-shaped";
  const p = await engine(strip);
  await p.user.create({ data: { id: "u1", email: "a@x.test", passwordHash: "h", updatedAt: now } });
  await p.oAuthIdentity.create({ data: { userId: "u1", provider: "google", subject: "s1" } });
  await p.user.create({ data: { id: "u2", email: "b@x.test", passwordHash: "h", updatedAt: now } });
  const uniqueEmail = await errOf(() => p.user.create({ data: { id: "u3", email: "a@x.test", passwordHash: "h", updatedAt: now } }));
  const uniqueSubject = await errOf(() => p.oAuthIdentity.create({ data: { userId: "u2", provider: "google", subject: "s1" } }));
  const uniquePerUser = await errOf(() => p.oAuthIdentity.create({ data: { userId: "u1", provider: "google", subject: "s2" } }));
  const fk = await errOf(() => p.oAuthIdentity.create({ data: { userId: "ghost", provider: "other", subject: "s3" } }));
  const generic = await errOf(() => p.$executeRawUnsafe(`INSERT INTO "NoSuchTable" VALUES (1)`));
  t(`engine ${label}: unique violations (email, subject, one-per-account) classify as unique`, [uniqueEmail, uniqueSubject, uniquePerUser].every((e) => constraintKind(e) === "unique"));
  t(`engine ${label}: a foreign-key violation classifies as foreign_key, never unique`, constraintKind(fk) === "foreign_key");
  t(`engine ${label}: a missing table is not a constraint failure (and is not mapped)`, constraintKind(generic) === null && mapKnownDatabaseError(generic) === null);
  t(`engine ${label}: HTTP mapping is 409 for unique and 400 for foreign key`, mapKnownDatabaseError(uniqueSubject)?.status === 409 && mapKnownDatabaseError(fk)?.status === 400);
  if (strip) {
    const e = uniqueSubject as Prisma.PrismaClientKnownRequestError;
    t("engine remote-shaped: the observed shape - a PrismaClientKnownRequestError with code SQLITE_CONSTRAINT, no meta.target", e instanceof Prisma.PrismaClientKnownRequestError && e.code === "SQLITE_CONSTRAINT" && (e.meta as { target?: unknown })?.target === undefined);
    t("engine remote-shaped: the driver text is the last line of the message", /UNIQUE constraint failed/.test(String(e.message).trim().split("\n").pop() ?? ""));
  } else {
    t("engine local-shaped: typed P2002 / P2003 are preserved", (uniqueEmail as Prisma.PrismaClientKnownRequestError).code === "P2002" && (fk as Prisma.PrismaClientKnownRequestError).code === "P2003");
  }
  await p.$disconnect();
}

// ---- the router-level 503 handler and the classes it must NOT take -------------------------------------------------------------
t("contention: P2028 (transaction expired, outcome uncertain) is NOT classified", !isTransientDatabaseContention(known("P2028", "Transaction API error: Transaction already closed: expired")));
t("contention: SQLITE_LOCKED and SQLITE_CONSTRAINT are NOT classified", !isTransientDatabaseContention(new LibsqlError("locked", "SQLITE_LOCKED")) && !isTransientDatabaseContention(new LibsqlError("c", "SQLITE_CONSTRAINT")) && !isTransientDatabaseContention(known("P2002")));
t("contention: an unrelated error object and non-errors are NOT classified", !isTransientDatabaseContention(new Error("SQLITE_BUSY: database is locked")) && !isTransientDatabaseContention(null) && !isTransientDatabaseContention("SQLITE_BUSY"));
{
  const run = (err: unknown, headersSent = false) => {
    const out: { status?: number; headers: Record<string, string>; body?: unknown; next?: unknown } = { headers: {} };
    const res: any = { headersSent, set: (k: string, v: string) => ((out.headers[k] = v), res), status: (c: number) => ((out.status = c), res), json: (b: unknown) => ((out.body = b), res) };
    const origError = console.error; console.error = () => {};
    try { transientContentionAs503(err, {} as any, res, (e?: unknown) => { out.next = e ?? "called"; }); } finally { console.error = origError; }
    return out;
  };
  const busy = new LibsqlError("SQLITE_BUSY: database is locked", "SQLITE_BUSY");
  const r1 = run(busy);
  t("503 handler: BUSY answers 503 with Retry-After: 1 and the fixed message, without calling next", r1.status === 503 && r1.headers["Retry-After"] === "1" && JSON.stringify(r1.body) === JSON.stringify({ error: SERVICE_BUSY_MESSAGE }) && r1.next === undefined);
  const r2 = run(busy, true);
  t("503 handler: headers already sent -> next(err), nothing written", r2.next === busy && r2.status === undefined);
  const p2028 = known("P2028", "expired"); const r3 = run(p2028);
  t("503 handler: P2028 / P1008 / constraint errors pass to next unchanged (no 503, no Retry-After)", r3.next === p2028 && r3.status === undefined && run(known("P1008")).status === undefined && run(known("P2002")).status === undefined && Object.keys(r3.headers).length === 0);
}

console.log(`${ok} db-error unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

/**
 * The DB_SCHEMA_BEHIND guard through the REAL @libsql/client HTTP (Hrana) client and the REAL @prisma/adapter-libsql — i.e. the
 * production code path for Turso — against a LOCAL PROTOCOL MOCK that plays the server side of Hrana-over-HTTP (v2 pipeline).
 *
 * What this proves: however the server words a missing-table/column error, the text reaches the guard intact through the client
 * and adapter, and unrelated failures (locked database, auth failure, 5xx, connection refused, other "no such …" errors) are not
 * misclassified. What it CANNOT prove: the wording of a real Turso server — that remains unverified (release blocker, see the PR).
 * No network beyond 127.0.0.1; no Turso URL or token is read or used.
 *
 *   npm run test:unit -w apps/server
 */
import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { checkSchema } from "../src/lib/schemaGuard.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

type Behaviour = { kind: "ok" } | { kind: "sqlError"; message: string; code?: string } | { kind: "http"; status: number; body: string };
let behaviour: Behaviour = { kind: "ok" };

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const send = (status: number, payload: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload);
    };
    if (req.method === "GET") return send(req.url === "/v2" ? 200 : 404, req.url === "/v2" ? "{}" : "{}"); // version negotiation: only v2
    if (!req.url?.endsWith("/v2/pipeline")) return send(404, "{}");
    if (behaviour.kind === "http") return send(behaviour.status, behaviour.body);
    let reqs: { type: string }[] = [];
    try { reqs = JSON.parse(body).requests ?? []; } catch { /* ignore */ }
    const results = reqs.map((r) => {
      if (r.type === "close") return { type: "ok", response: { type: "close" } };
      if (behaviour.kind === "sqlError") return { type: "error", error: { message: behaviour.message, ...(behaviour.code ? { code: behaviour.code } : {}) } };
      return { type: "ok", response: { type: "execute", result: { cols: [{ name: "x" }], rows: [], affected_row_count: 0, last_insert_rowid: null } } };
    });
    send(200, JSON.stringify({ baton: null, base_url: null, results }));
  });
});

async function verdict(url: string): Promise<string> {
  const db = new PrismaClient({ adapter: new PrismaLibSQL(createClient({ url, authToken: "local-test-token", intMode: "number" })) });
  try {
    return await checkSchema(db);
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  behaviour = { kind: "ok" };
  t("remote client: a healthy schema is ok", (await verdict(url)) === "ok");

  const behind: [string, string, string | undefined][] = [
    ["sqld-style wording", "SQLite error: no such table: OAuthIdentity", "SQLITE_UNKNOWN"],
    ["bare SQLite wording, column", "no such column: TeamMember.scholarUrl", "SQLITE_ERROR"],
    ["code-prefixed wording", "SQLITE_ERROR: no such table: main.SyncState", undefined],
    ["Stream error wrapper", "Stream error: SQLite error: no such column: TeamMember.orcid", "SQLITE_UNKNOWN"],
    ["upper-case", "NO SUCH TABLE: PublicationCandidate", "SQLITE_ERROR"],
  ];
  for (const [label, message, code] of behind) {
    behaviour = { kind: "sqlError", message, code };
    t(`remote client: ${label} -> behind`, (await verdict(url)) === "behind", message);
  }

  const unrelated: [string, Behaviour][] = [
    ["database is locked", { kind: "sqlError", message: "SQLite error: database is locked", code: "SQLITE_BUSY" }],
    ["disk I/O error", { kind: "sqlError", message: "SQLite error: disk I/O error", code: "SQLITE_IOERR" }],
    ["other 'no such' errors", { kind: "sqlError", message: "SQLite error: no such function: foo", code: "SQLITE_ERROR" }],
    ["a syntax error", { kind: "sqlError", message: 'SQLite error: near "FROM": syntax error', code: "SQLITE_ERROR" }],
    ["auth failure (401)", { kind: "http", status: 401, body: '{"error":"Unauthorized: `The JWT is invalid`"}' }],
    ["server error (503)", { kind: "http", status: 503, body: "upstream unavailable" }],
    ["a proxy HTML page", { kind: "http", status: 502, body: "<html>Bad Gateway</html>" }],
  ];
  for (const [label, b] of unrelated) {
    behaviour = b;
    const v = await verdict(url);
    t(`remote client: ${label} is NOT schema-behind`, v === "unknown", v);
  }

  await new Promise<void>((r) => server.close(() => r()));
  t("remote client: connection refused is NOT schema-behind", (await verdict(url)) === "unknown");

  console.log(`${ok} remote-adapter schema-guard checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}
const keep = setInterval(() => undefined, 1000);
main().finally(() => clearInterval(keep));

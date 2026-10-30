import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type Client, type Transaction } from "@libsql/client";

/**
 * Executor for the REVIEWED additive migrations (the two gallery multi-image migrations, the Phase 2.2 OAuth identity
 * migration, the Phase 3B `TeamMember.isPublished` column, the Phase 3C research-link columns and the publication-metadata
 * `Publication` columns) against a libSQL/Turso database.
 *
 * `prisma migrate deploy` cannot talk to Turso (docs/user-guide/en/site-maintainer-guide.md), so these
 * ADDITIVE migrations need a deliberate, repeatable way in. This module is the importable core (no side
 * effects, no environment access); `scripts/turso-migrate.ts` is the command-line wrapper.
 *
 * Safety properties (each is exercised by scripts/unit-turso-migrate.test.ts on disposable LOCAL SQLite files):
 *  - ONLY migrations whose normalised SHA-256 is pinned in REVIEWED_MIGRATIONS are applied. Editing a
 *    migration file therefore requires editing (and reviewing) this list.
 *  - ONLY `CREATE TABLE` / `CREATE [UNIQUE] INDEX` statements are accepted, plus ONE exact form of `ALTER TABLE`:
 *    `ALTER TABLE "T" ADD COLUMN "c" BOOLEAN|INTEGER NOT NULL DEFAULT true|false|<integer>` (a metadata-only change in SQLite:
 *    constant default, no table copy, no references, no constraints). Every other ALTER (RENAME, DROP COLUMN, ADD COLUMN with a
 *    nullable/non-constant/quoted default, REFERENCES, UNIQUE, PRIMARY KEY, CHECK, several clauses) is refused, as is anything else.
 *    A migration that adds columns may contain nothing but such statements.
 *  - The target must be selected explicitly and its identity confirmed by the caller (`parseTarget`).
 *  - The current state of each migration is classified before anything is written; a partially applied or
 *    divergent migration, or an unexpected object, FAILS CLOSED (nothing is written).
 *  - All statements run inside ONE write transaction. Inside it the executor re-checks the state, applies the
 *    SQL, verifies the exact resulting schema against a sandbox reference and that the data tables' row
 *    counts are unchanged, and only then commits. Any problem rolls the transaction back.
 *  - If COMMIT reports an error the executor does not guess: it re-reads the database and reports whether the
 *    migrations are applied, absent or partial.
 *
 * LIMIT OF THE EVIDENCE: the tests prove this logic against SQLite files. They cannot prove that a remote
 * Turso database honours transactional DDL, how it reports a lost COMMIT reply, or which database a
 * credential really points at. The checks that stay in force on any target (state classification, in-
 * transaction verification, post-run re-inspection, identity confirmation) exist because of that.
 */

export interface ReviewedMigration {
  name: string;
  /** SHA-256 of the migration file with CRLF normalised to LF. */
  sha256: string;
}

export const REVIEWED_MIGRATIONS: readonly ReviewedMigration[] = [
  { name: "20261011130000_gallery_item_images", sha256: "aee1e5aa992ef1c0db9c66133326a6b9503f27d3a52edf4e7d6968bf6ecc6728" },
  { name: "20261011140000_gallery_upload_attempts", sha256: "20d099cc1dd7f7c30deaabf92a10ed12355b982e627435142efb17c585228e81" },
  // Phase 2.2: additive OAuthIdentity table (1 table + 2 unique indexes, FK to User ON DELETE CASCADE). Reviewed hash of the
  // exact file; any edit to it is refused until this entry is re-reviewed. Chronological order matters (applied in order).
  { name: "20261012100000_oauth_identity", sha256: "7803d5ae2f5a02efc308928e56305763344250015721b8253bfa505959822a2e" },
  // Phase 3B: ONE `ALTER TABLE "TeamMember" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true` (metadata-only; existing rows read back
  // as published). Pin computed with the same `sha256` above over the LF-normalised file; see docs/architecture/turso-migration-executor.md.
  { name: "20261020120000_team_member_is_published", sha256: "502f8fc34ad05d596084f980c12908c3b01b09eea5e80bb6fd8841b1bf18ce4b" },
  // Phase 3C: THREE `ALTER TABLE "TeamMember" ADD COLUMN "<x>Url" TEXT NOT NULL DEFAULT ''` (googleScholarUrl, researchGateUrl, orcidUrl; metadata-only; existing
  // rows read back as ''). Local rehearsal only so far; NOT applied to any remote database. See docs/architecture/phase3c-research-links.md.
  { name: "20261027120000_team_member_research_links", sha256: "61e1bfbe7b159897cdb08c024b515fc8e74e94e978948dc2a4aae92e0cb69a44" },
  // Publication metadata: EIGHT `ALTER TABLE "Publication" ADD COLUMN "<x>" TEXT NOT NULL DEFAULT ''` / `INTEGER NOT NULL DEFAULT 0` (status, listNumber, category, volume,
  // startPage, endPage, month, acceptedDate; metadata-only; existing rows read back as '' / 0). Pin computed over the LF-normalised file. Listing it here does NOT apply it
  // anywhere; it has not been applied to any remote database.
  { name: "20261030120000_publication_metadata_fields", sha256: "df2db5062779488ec735b43de48c8710861eedb1ee6f36cf3f29969af0413a18" },
];

/** Tables that must already exist in the target for it to be this application's database. */
export const REQUIRED_EXISTING_TABLES = ["User", "StoredFile", "GalleryItem"] as const;
/** Data tables whose row counts must be identical before and after (inside the write transaction). */
export const COUNTED_TABLES = ["User", "StoredFile", "GalleryItem"] as const;

export class MigrationRefusal extends Error {
  constructor(
    message: string,
    readonly code: "TARGET" | "MIGRATION_FILE" | "NOT_ADDITIVE" | "PREREQUISITE" | "STATE" | "VERIFY" | "COMMIT",
  ) {
    super(message);
    this.name = "MigrationRefusal";
  }
}

// ---------------------------------------------------------------------------------------------------------
// Migration files

export interface MigrationSpec {
  name: string;
  sql: string;
  statements: ParsedStatement[];
}

export interface ParsedStatement {
  sql: string;
  kind: "table" | "index" | "column";
  /** Name of the created table or index; for a column, `Table.column`. */
  name: string;
  /** The table the statement creates, indexes or adds a column to. */
  table: string;
  /** Tables named in REFERENCES clauses. */
  references: string[];
  /** Columns only. */
  column?: { name: string; type: "BOOLEAN" | "INTEGER" | "TEXT"; defaultValue: string };
}

const normaliseEol = (s: string) => s.replace(/\r\n/g, "\n");
export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Splits a migration into statements. Deliberately strict: comments are whole lines starting with `--`. */
export function splitStatements(sql: string): string[] {
  const withoutComments = normaliseEol(sql)
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  // The ONLY quoted token accepted is the empty-string default of an added text column, and only as a whole statement of exactly that shape
  // (anchored to the line start and followed by the `;`). It contains no `;` and cannot hide one. `DEFAULT ''` inside a CREATE TABLE, any
  // non-empty literal, backticks and block comments are all still refused.
  const scrubbed = withoutComments.replace(/^ALTER TABLE "[A-Za-z0-9_]+" ADD COLUMN "[A-Za-z0-9_]+" TEXT NOT NULL DEFAULT ''(?=[ \t]*;)/gm, "ALTER TABLE X");
  if (/['`]|\/\*|\*\//.test(scrubbed)) {
    throw new MigrationRefusal("Migration contains a quote or block comment; this executor only accepts plain DDL.", "NOT_ADDITIVE");
  }
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const CREATE_TABLE = /^CREATE TABLE "([A-Za-z0-9_]+)" \(/;
/** The one accepted ALTER form (see the header). The default is a bare constant: true, false or an integer. */
const ADD_COLUMN = /^ALTER TABLE "([A-Za-z0-9_]+)" ADD COLUMN "([A-Za-z0-9_]+)" (BOOLEAN|INTEGER) NOT NULL DEFAULT (true|false|-?[0-9]{1,9})$/;
// The ONE additional column form (Phase 3C research links): text that defaults to the empty string. Deliberately not "any TEXT default": a
// non-empty or expression default, a nullable column or any other type is still refused, so the executor's permissions are not broadened.
const ADD_TEXT_COLUMN = /^ALTER TABLE "([A-Za-z0-9_]+)" ADD COLUMN "([A-Za-z0-9_]+)" (TEXT) NOT NULL DEFAULT ('')$/;
const CREATE_INDEX = /^CREATE (?:UNIQUE )?INDEX "([A-Za-z0-9_]+)" ON "([A-Za-z0-9_]+)"\(/;

/** Refuses anything that is not a plain additive CREATE TABLE / CREATE INDEX. */
export function parseAdditive(sql: string): ParsedStatement[] {
  const statements = splitStatements(sql);
  if (statements.length === 0) throw new MigrationRefusal("Migration contains no statements.", "NOT_ADDITIVE");
  const parsed = statements.map((stmt) => {
    const col = ADD_COLUMN.exec(stmt) ?? ADD_TEXT_COLUMN.exec(stmt);
    if (col) {
      return {
        sql: stmt,
        kind: "column" as const,
        name: `${col[1]}.${col[2]}`,
        table: col[1],
        references: [] as string[],
        column: { name: col[2], type: col[3] as "BOOLEAN" | "INTEGER" | "TEXT", defaultValue: col[4] },
      };
    }
    const table = CREATE_TABLE.exec(stmt);
    const index = CREATE_INDEX.exec(stmt);
    if (!table && !index) {
      throw new MigrationRefusal(`Refusing a non-additive or unrecognised statement: ${stmt.slice(0, 60).replace(/\s+/g, " ")}…`, "NOT_ADDITIVE");
    }
    const references = [...stmt.matchAll(/REFERENCES "([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    return table
      ? { sql: stmt, kind: "table" as const, name: table[1], table: table[1], references }
      : { sql: stmt, kind: "index" as const, name: index![1], table: index![2], references };
  });
  // Keep the model simple: a migration either only adds columns or only creates tables/indexes, and never adds the same column twice.
  const hasColumn = parsed.some((p) => p.kind === "column");
  if (hasColumn && parsed.some((p) => p.kind !== "column")) {
    throw new MigrationRefusal("A migration that adds columns may not also create tables or indexes.", "NOT_ADDITIVE");
  }
  if (new Set(parsed.map((p) => p.name)).size !== parsed.length) throw new MigrationRefusal("The same object is created or altered twice.", "NOT_ADDITIVE");
  return parsed;
}

/** Reads the pinned migrations from `migrationsDir`; any hash mismatch refuses the whole run. */
export function loadReviewedMigrations(migrationsDir: string, reviewed: readonly ReviewedMigration[] = REVIEWED_MIGRATIONS): MigrationSpec[] {
  return reviewed.map(({ name, sha256: pinned }) => {
    let raw: string;
    try {
      raw = readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
    } catch {
      throw new MigrationRefusal(`Migration file for ${name} could not be read.`, "MIGRATION_FILE");
    }
    const sql = normaliseEol(raw);
    if (sha256(sql) !== pinned) {
      throw new MigrationRefusal(`Migration ${name} does not match the reviewed version (hash mismatch). Update REVIEWED_MIGRATIONS only after review.`, "MIGRATION_FILE");
    }
    return { name, sql, statements: parseAdditive(sql) };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Target selection

export interface TargetConfig {
  url: string;
  authToken?: string;
}

export interface ParsedTarget {
  kind: "file" | "remote";
  /** The identity the operator must confirm: the lower-cased hostname (remote) or the file path (file:). Never a credential. */
  identity: string;
  url: string;
  authToken?: string;
}

/**
 * Validates an explicitly selected target. Throws MigrationRefusal for a missing, ambiguous or unconfirmed
 * target. Error messages never contain the URL's userinfo/query or the token.
 */
export function parseTarget(config: Partial<TargetConfig>, expectedIdentity: string | undefined): ParsedTarget {
  const url = config.url?.trim();
  if (!url) throw new MigrationRefusal("No target selected: set the target URL explicitly.", "TARGET");
  if (!expectedIdentity?.trim()) throw new MigrationRefusal("The target identity must be confirmed explicitly (the expected host, or the file path for a local file).", "TARGET");

  let parsed: ParsedTarget;
  if (url.startsWith("file:")) {
    if (config.authToken) throw new MigrationRefusal("A local file target must not be given a token (ambiguous target).", "TARGET");
    const filePath = url.slice("file:".length);
    if (!path.isAbsolute(filePath)) throw new MigrationRefusal("A local file target must be an absolute path (file:/abs/path.db).", "TARGET");
    parsed = { kind: "file", identity: `file:${path.normalize(filePath)}`, url: `file:${path.normalize(filePath)}` };
  } else {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new MigrationRefusal("The target URL is not valid.", "TARGET");
    }
    if (u.protocol !== "libsql:" && u.protocol !== "https:") throw new MigrationRefusal("A remote target must use libsql:// or https://.", "TARGET");
    if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== "/")) {
      throw new MigrationRefusal("The target URL must be just the scheme and host (no credentials, path or query).", "TARGET");
    }
    const host = u.hostname.toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.turso\.io$/.test(host)) {
      throw new MigrationRefusal("A remote target must be a *.turso.io host.", "TARGET");
    }
    if (!config.authToken?.trim()) throw new MigrationRefusal("A remote target needs its auth token (set it in the environment, never on the command line).", "TARGET");
    parsed = { kind: "remote", identity: host, url: `libsql://${host}`, authToken: config.authToken.trim() };
  }
  if (expectedIdentity.trim().toLowerCase() !== parsed.identity.toLowerCase()) {
    throw new MigrationRefusal(`Target identity mismatch: the selected target is "${parsed.identity}", which is not the confirmed target.`, "TARGET");
  }
  return parsed;
}

export function openTarget(target: ParsedTarget): Client {
  return createClient(target.kind === "remote" ? { url: target.url, authToken: target.authToken } : { url: target.url });
}

/** Removes any credential that may have leaked into a message. */
export function redact(message: string, secrets: Array<string | undefined>): string {
  return secrets.reduce<string>((m, s) => (s && s.length >= 4 ? m.split(s).join("***") : m), message);
}

// ---------------------------------------------------------------------------------------------------------
// Introspection

type Db = Pick<Client, "execute"> | Pick<Transaction, "execute">;

export interface ObjectDef {
  type: string;
  name: string;
  table: string;
  /** Whitespace-normalised CREATE text as stored by SQLite. */
  sql: string;
  /** Tables only: structural description from PRAGMA table_info / foreign_key_list / index_list. */
  structure?: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

async function rows(db: Db, sql: string, args: Array<string | number> = []) {
  return (await db.execute({ sql, args })).rows;
}

export async function describeObject(db: Db, name: string): Promise<ObjectDef | undefined> {
  const r = await rows(db, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name = ?", [name]);
  if (r.length === 0) return undefined;
  const o = r[0];
  const def: ObjectDef = { type: String(o.type), name: String(o.name), table: String(o.tbl_name), sql: squash(String(o.sql ?? "")) };
  if (def.type === "table") {
    const cols = (await rows(db, `PRAGMA table_info(${q(name)})`)).map((c) => [c.cid, c.name, c.type, c.notnull, c.dflt_value, c.pk]);
    const fks = (await rows(db, `PRAGMA foreign_key_list(${q(name)})`)).map((f) => [f.table, f.from, f.to, f.on_update, f.on_delete]).sort();
    // Explicit indexes (origin "c") are separate objects classified on their own, so a table whose indexes are
    // missing is "partial", not "divergent". Constraint-backed indexes (primary key / UNIQUE) belong to the table.
    const idx = (await rows(db, `PRAGMA index_list(${q(name)})`)).filter((i) => i.origin !== "c").map((i) => [i.name, i.unique, i.origin, i.partial]).sort();
    def.structure = JSON.stringify({ cols, fks, idx });
  }
  return def;
}

const columnDef = (table: string, name: string, type: string, notnull: unknown, dflt: unknown): ObjectDef => ({
  type: "column",
  name: `${table}.${name}`,
  table,
  sql: "",
  structure: JSON.stringify({ type: String(type).toUpperCase(), notnull: Number(notnull), dflt: dflt === null || dflt === undefined ? null : String(dflt) }),
});

/** A column as the target reports it (PRAGMA table_info), or undefined when the table or the column is absent. */
export async function describeColumn(db: Db, table: string, column: string): Promise<ObjectDef | undefined> {
  const c = (await rows(db, `PRAGMA table_info(${q(table)})`)).find((r) => String(r.name) === column);
  return c ? columnDef(table, column, String(c.type), c.notnull, c.dflt_value) : undefined;
}

/** Objects in the target whose name starts with `prefix`, other than the expected ones (and SQLite's own autoindexes). */
async function unexpectedObjects(db: Db, tables: string[], expected: Set<string>): Promise<string[]> {
  const found: string[] = [];
  for (const t of tables) {
    const r = await rows(db, "SELECT name FROM sqlite_master WHERE (name = ? OR name LIKE ? ESCAPE '\\') AND name NOT LIKE 'sqlite_autoindex_%'", [t, `${t.replace(/[\\%_]/g, "\\$&")}\\_%`]);
    for (const row of r) if (!expected.has(String(row.name))) found.push(String(row.name));
  }
  return found;
}

/** The reference schema: the migration's own SQL applied to an empty in-memory database. */
export async function expectedSchema(migration: MigrationSpec): Promise<Map<string, ObjectDef>> {
  const sandbox = createClient({ url: ":memory:" });
  try {
    const out = new Map<string, ObjectDef>();
    // A column's expected shape is exactly what the (strictly parsed) statement says; SQLite stores the default text as written.
    for (const s of migration.statements) if (s.kind === "column") out.set(s.name, columnDef(s.table, s.column!.name, s.column!.type, 1, s.column!.defaultValue));
    for (const s of migration.statements.filter((x) => x.kind !== "column")) await sandbox.execute(s.sql);
    for (const s of migration.statements.filter((x) => x.kind !== "column")) {
      const def = await describeObject(sandbox, s.name);
      if (!def) throw new MigrationRefusal(`Sandbox did not create ${s.name}.`, "NOT_ADDITIVE");
      out.set(s.name, def);
    }
    return out;
  } finally {
    sandbox.close();
  }
}

export type MigrationStatus = "absent" | "applied" | "partial" | "divergent";

export interface MigrationState {
  name: string;
  status: MigrationStatus;
  present: string[];
  missing: string[];
  differing: string[];
  unexpected: string[];
}

export async function classify(db: Db, migration: MigrationSpec, expected: Map<string, ObjectDef>): Promise<MigrationState> {
  const present: string[] = [];
  const missing: string[] = [];
  const differing: string[] = [];
  for (const [name, want] of expected) {
    const col = migration.statements.find((s) => s.name === name && s.kind === "column");
    const have = col ? await describeColumn(db, col.table, col.column!.name) : await describeObject(db, name);
    if (!have) missing.push(name);
    else if (have.type !== want.type || have.table !== want.table || have.sql !== want.sql || have.structure !== want.structure) differing.push(name);
    else present.push(name);
  }
  const tables = migration.statements.filter((s) => s.kind === "table").map((s) => s.name);
  const unexpected = await unexpectedObjects(db, tables, new Set(expected.keys()));
  let status: MigrationStatus;
  if (differing.length > 0 || unexpected.length > 0) status = "divergent";
  else if (missing.length === 0) status = "applied";
  else if (present.length === 0) status = "absent";
  else status = "partial";
  return { name: migration.name, status, present, missing, differing, unexpected };
}

export async function countTables(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNTED_TABLES) out[t] = Number((await rows(db, `SELECT COUNT(*) AS n FROM ${q(t)}`))[0].n);
  out["StoredFile(live)"] = Number((await rows(db, `SELECT COUNT(*) AS n FROM ${q("StoredFile")} WHERE "deletedAt" IS NULL`))[0].n);
  return out;
}

/** Row counts of the tables that receive an added column (so the check works for any such table, not a fixed list). */
async function countRowsOf(db: Db, columnStatements: ParsedStatement[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of new Set(columnStatements.map((s) => s.table))) out[t] = Number((await rows(db, `SELECT COUNT(*) AS n FROM ${q(t)}`))[0].n);
  return out;
}

async function assertPrerequisites(db: Db, migrations: MigrationSpec[]) {
  const needed = new Set<string>(REQUIRED_EXISTING_TABLES);
  const created = new Set(migrations.flatMap((m) => m.statements.filter((s) => s.kind === "table").map((s) => s.name)));
  for (const m of migrations) for (const s of m.statements) for (const r of s.references) if (!created.has(r)) needed.add(r);
  // A column is added to a table that must already exist.
  for (const m of migrations) for (const s of m.statements) if (s.kind === "column") needed.add(s.table);
  const missing: string[] = [];
  for (const t of needed) {
    const d = await describeObject(db, t);
    if (!d || d.type !== "table") missing.push(t);
  }
  if (missing.length) {
    throw new MigrationRefusal(`The target does not look like this application's database: missing table(s) ${missing.join(", ")}.`, "PREREQUISITE");
  }
}

// ---------------------------------------------------------------------------------------------------------
// Planning and applying

export interface Report {
  mode: "check" | "apply";
  /** `nothing-to-do`: all applied already. `planned`: check mode, work is pending. `applied`: committed and re-verified. */
  outcome: "nothing-to-do" | "planned" | "applied" | "applied-after-commit-error";
  before: MigrationState[];
  after: MigrationState[];
  countsBefore: Record<string, number>;
  countsAfter: Record<string, number>;
  appliedMigrations: string[];
}

export interface ExecuteOptions {
  apply: boolean;
  /** Test seam: wraps the write transaction (e.g. to inject a failure). */
  wrapTransaction?: (tx: Transaction) => Transaction;
  /** Test seam: runs after the read-only inspection and before the write transaction (e.g. to change the database under it). */
  afterInspect?: () => Promise<void>;
}

async function inspect(db: Db, migrations: MigrationSpec[], expected: Map<string, Map<string, ObjectDef>>) {
  const states: MigrationState[] = [];
  for (const m of migrations) states.push(await classify(db, m, expected.get(m.name)!));
  return states;
}

function describeState(s: MigrationState): string {
  const parts = [`${s.name}: ${s.status}`];
  if (s.missing.length) parts.push(`missing [${s.missing.join(", ")}]`);
  if (s.differing.length) parts.push(`different [${s.differing.join(", ")}]`);
  if (s.unexpected.length) parts.push(`unexpected [${s.unexpected.join(", ")}]`);
  return parts.join("; ");
}

function assertNoUnsafeState(states: MigrationState[]) {
  const bad = states.filter((s) => s.status === "partial" || s.status === "divergent");
  if (bad.length) {
    throw new MigrationRefusal(
      `Refusing to continue; nothing was written. ${bad.map(describeState).join(" | ")}. A partially applied or divergent migration needs a reviewed manual repair or a point-in-time restore.`,
      "STATE",
    );
  }
}

export async function execute(client: Client, migrations: MigrationSpec[], options: ExecuteOptions): Promise<Report> {
  const expected = new Map<string, Map<string, ObjectDef>>();
  for (const m of migrations) expected.set(m.name, await expectedSchema(m));

  // 1. Read-only inspection. Nothing below this line may write until the state is known to be safe.
  await assertPrerequisites(client, migrations);
  const before = await inspect(client, migrations, expected);
  assertNoUnsafeState(before);
  const pending = migrations.filter((_, i) => before[i].status === "absent");
  const countsBefore = await countTables(client);
  if (pending.length === 0) {
    return { mode: options.apply ? "apply" : "check", outcome: "nothing-to-do", before, after: before, countsBefore, countsAfter: countsBefore, appliedMigrations: [] };
  }
  if (!options.apply) {
    return { mode: "check", outcome: "planned", before, after: before, countsBefore, countsAfter: countsBefore, appliedMigrations: [] };
  }

  // 2. One write transaction: re-check, apply, verify, then commit.
  await options.afterInspect?.();
  const rawTx = await client.transaction("write");
  const tx = options.wrapTransaction ? options.wrapTransaction(rawTx) : rawTx;
  let committed = false;
  try {
    const recheck = await inspect(tx, migrations, expected);
    assertNoUnsafeState(recheck);
    const stillPending = migrations.filter((_, i) => recheck[i].status === "absent");
    if (stillPending.length !== pending.length) {
      throw new MigrationRefusal("The database changed between inspection and the write transaction; nothing was written. Re-run.", "STATE");
    }
    const txBefore = await countTables(tx);
    const columnStatements = pending.flatMap((m) => m.statements.filter((s) => s.kind === "column"));
    const columnRowsBefore = await countRowsOf(tx, columnStatements);
    for (const m of pending) for (const s of m.statements) await tx.execute(s.sql);
    const verified = await inspect(tx, migrations, expected);
    const notApplied = verified.filter((s) => s.status !== "applied");
    if (notApplied.length) {
      throw new MigrationRefusal(`Verification inside the transaction failed; rolling back. ${notApplied.map(describeState).join(" | ")}`, "VERIFY");
    }
    const txAfter = await countTables(tx);
    // Added columns: no row appeared or vanished, and every EXISTING row received the default (nothing is NULL or different).
    if (JSON.stringify(columnRowsBefore) !== JSON.stringify(await countRowsOf(tx, columnStatements))) {
      throw new MigrationRefusal("Row counts changed inside the transaction for a table that received a column; rolling back.", "VERIFY");
    }
    for (const s of columnStatements) {
      const literal = s.column!.defaultValue === "true" ? "1" : s.column!.defaultValue === "false" ? "0" : s.column!.defaultValue;
      const off = Number((await rows(tx, `SELECT COUNT(*) AS n FROM ${q(s.table)} WHERE ${q(s.column!.name)} IS NOT ${literal}`))[0].n);
      if (off !== 0) throw new MigrationRefusal(`${off} existing row(s) of ${s.table} did not receive the default for ${s.column!.name}; rolling back.`, "VERIFY");
    }
    if (JSON.stringify(txBefore) !== JSON.stringify(txAfter)) {
      throw new MigrationRefusal(`Row counts changed inside the transaction (${JSON.stringify(txBefore)} -> ${JSON.stringify(txAfter)}); rolling back.`, "VERIFY");
    }
    try {
      await tx.commit();
      committed = true;
    } catch (commitError) {
      // The outcome of COMMIT is unknown: do not guess, read the database again.
      const reread = await inspect(client, migrations, expected);
      const allApplied = reread.every((s) => s.status === "applied");
      const noneApplied = pending.every((m) => reread.find((s) => s.name === m.name)!.status === "absent");
      if (allApplied) {
        return { mode: "apply", outcome: "applied-after-commit-error", before, after: reread, countsBefore, countsAfter: await countTables(client), appliedMigrations: pending.map((m) => m.name) };
      }
      if (noneApplied) {
        throw new MigrationRefusal(`COMMIT failed and the migrations are NOT applied (${commitError instanceof Error ? commitError.message : "unknown error"}). Safe to re-run after checking the connection.`, "COMMIT");
      }
      throw new MigrationRefusal(`COMMIT reported an error and the schema is now PARTIAL or divergent: ${reread.map(describeState).join(" | ")}. Stop; restore from the recovery point or repair manually.`, "COMMIT");
    }
  } catch (err) {
    if (!committed) {
      try {
        await tx.rollback();
      } catch {
        /* the transaction may already be closed */
      }
    }
    throw err;
  } finally {
    tx.close();
  }

  // 3. Independent re-inspection after COMMIT.
  const after = await inspect(client, migrations, expected);
  const bad = after.filter((s) => s.status !== "applied");
  if (bad.length) throw new MigrationRefusal(`Post-commit verification failed: ${bad.map(describeState).join(" | ")}`, "VERIFY");
  // Counts may legitimately move on a live site between the pre-read and now; the in-transaction comparison
  // (made while the write lock was held) is the authoritative "existing data untouched" check.
  const countsAfter = await countTables(client);
  return { mode: "apply", outcome: "applied", before, after, countsBefore, countsAfter, appliedMigrations: pending.map((m) => m.name) };
}

/**
 * For a REMOTE apply the operator must state the recovery point they recorded (a UTC timestamp, taken from the
 * Turso point-in-time-recovery window just before the run). It is only sanity-checked (parseable, not in the
 * future, not older than `maxAgeHours`) and printed into the run log; the executor cannot verify a backup.
 */
export function assertRecoveryPoint(value: string | undefined, now: Date, maxAgeHours = 24): Date {
  if (!value?.trim()) throw new MigrationRefusal("--recovery-point <UTC ISO timestamp> is required to apply to a remote database.", "TARGET");
  const t = new Date(value.trim());
  if (Number.isNaN(t.getTime()) || !/Z$|[+-]\d\d:\d\d$/.test(value.trim())) throw new MigrationRefusal("--recovery-point must be an ISO timestamp with a timezone, e.g. 2026-10-12T01:30:00Z.", "TARGET");
  if (t.getTime() > now.getTime()) throw new MigrationRefusal("--recovery-point is in the future.", "TARGET");
  if (now.getTime() - t.getTime() > maxAgeHours * 3600_000) throw new MigrationRefusal(`--recovery-point is older than ${maxAgeHours} hours; record a fresh one.`, "TARGET");
  return t;
}

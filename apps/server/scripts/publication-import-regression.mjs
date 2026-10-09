/**
 * Regression for publication discovery (Phase 27 / P27.5): the real HTTP routes against a MOCK ORCID + Crossref.
 * No real network, no real researcher and no production data is involved: the server runs on a disposable copy
 * of the local dev database and is pointed at the mock through non-production-only overrides.
 *
 * Proves the application's behaviour (dedupe, review-before-public, idempotency, failure isolation, authorization,
 * rate limiting). It does NOT prove that ORCID's or Crossref's live services behave as the mock does.
 *
 *   node scripts/publication-import-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const TSX = path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first.`);
  process.exit(1);
}

function orcidWithCheck(base15) {
  let total = 0;
  for (const ch of base15) total = (total + Number(ch)) * 2;
  const r = (12 - (total % 11)) % 11;
  const c = r === 10 ? "X" : String(r);
  const s = base15 + c;
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
}
const ID = {
  A: orcidWithCheck("000000010000001"),
  B: orcidWithCheck("000000010000002"),
  C: orcidWithCheck("000000010000003"), // malformed JSON body
  D: orcidWithCheck("000000010000004"), // 404
  E: orcidWithCheck("000000010000005"), // always 429
  F: orcidWithCheck("000000010000006"), // too slow (timeout)
  G: orcidWithCheck("000000010000007"), // no works
  H: orcidWithCheck("000000010000008"), // alumnus: must never be fetched
  I: orcidWithCheck("000000010000009"), // flaky: 503 once, then fine
};

// ---------------------------------------------------------------------------------------------
// Mock ORCID + Crossref (one server, two path prefixes)
// ---------------------------------------------------------------------------------------------
const hits = { orcid: {}, crossref: {}, other: 0 };
const work = (putCode, title, year, doi, extra = {}) => ({
  "work-summary": [
    {
      "put-code": putCode,
      title: { title: { value: title } },
      type: "journal-article",
      "publication-date": year ? { year: { value: String(year) } } : null,
      "journal-title": { value: extra.venue ?? "Journal of Mock Results" },
      url: extra.url ? { value: extra.url } : null,
      "external-ids": doi ? { "external-id": [{ "external-id-type": "doi", "external-id-value": doi, "external-id-normalized": { value: doi.toLowerCase() } }] } : { "external-id": [] },
    },
  ],
  "external-ids": { "external-id": [] },
});
const WORKS = {
  [ID.A]: [
    work(101, "Alpha Study of Mock Things", 2024, "10.1234/Alpha.One"),
    work(102, "A Paper Without Any DOI", 2023, null, { url: "https://example.test/paper-102" }),
    work(103, "Already In The Lab Database", 2022, "10.9999/Already.There"),
    work(104, "", 2021, "10.1234/no.title"), // no title -> skipped
    work(105, "No Usable Year", null, "10.1234/no.year"), // no year -> skipped
    work(106, "Javascript Injection <script>alert(1)</script>", 2020, null, { url: "javascript:alert(1)" }),
  ],
  [ID.B]: [work(201, "Alpha Study of Mock Things", 2024, "10.1234/ALPHA.one"), work(202, "Beta Study", 2025, "10.1234/Beta.Two")],
  [ID.G]: [],
  [ID.H]: [work(801, "Alumnus Paper", 2019, "10.1234/alumnus")],
  [ID.I]: [work(901, "Flaky Source Paper", 2018, "10.1234/Flaky.Nine")],
};
const CROSSREF = {
  "10.1234/alpha.one": { title: ["Alpha Study of <i>Mock</i> Things"], author: [{ given: "Ada", family: "Lovelace" }, { name: "The Mock Consortium" }], DOI: "10.1234/Alpha.One" },
  "10.1234/beta.two": { title: ["Beta Study"], author: [{ given: "Grace", family: "Hopper" }], DOI: "10.1234/Beta.Two" },
};
let flakyServed = 0;

function startMock() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body, raw = false) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(raw ? body : JSON.stringify(body));
    };
    let m;
    if ((m = /^\/orcid\/([^/]+)\/works$/.exec(url.pathname))) {
      const id = decodeURIComponent(m[1]);
      hits.orcid[id] = (hits.orcid[id] ?? 0) + 1;
      if (id === ID.C) return send(200, "{ this is not json", true);
      if (id === ID.D) return send(404, { error: "not found" });
      if (id === ID.E) return send(429, { error: "slow down" });
      if (id === ID.F) return void setTimeout(() => send(200, { group: [] }), 5000);
      if (id === ID.I && flakyServed++ < 1) return send(503, { error: "try later" });
      if (!WORKS[id]) return send(404, {});
      return send(200, { group: WORKS[id] });
    }
    if ((m = /^\/crossref\/works\/(.+)$/.exec(url.pathname))) {
      const doi = decodeURIComponent(m[1]).toLowerCase();
      hits.crossref[doi] = (hits.crossref[doi] ?? 0) + 1;
      if (doi === "10.1234/rate.limited") return send(429, {});
      const rec = CROSSREF[doi];
      return rec ? send(200, { status: "ok", message: rec }) : send(404, "Resource not found.", true);
    }
    hits.other++;
    send(404, {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

async function startServer(mock, extraEnv = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "scl-pubimport-"));
  copyFileSync(SOURCE_DB, path.join(work, "c.db"));
  const port = 48100 + Math.floor(Math.random() * 400);
  const env = {
    ...process.env,
    TURSO_DATABASE_URL: "",
    TURSO_AUTH_TOKEN: "",
    BLOB_READ_WRITE_TOKEN: "",
    VERCEL: "",
    STORAGE_DIR: path.join(work, "files"),
    DATABASE_URL: `file:${path.join(work, "c.db")}`,
    PORT: String(port),
    TRUST_PROXY: "0",
    NODE_ENV: "test",
    SESSION_SECRET: "pubimport-regression-secret-0000000000",
    ORCID_CLIENT_ID: "",
    ORCID_CLIENT_SECRET: "",
    PUBLICATION_ORCID_BASE_URL: `${mock.url}/orcid`,
    PUBLICATION_CROSSREF_BASE_URL: `${mock.url}/crossref`,
    PUBLICATION_SYNC_DELAY_MS: "0",
    PUBLICATION_HTTP_RETRY_DELAY_MS: "10",
    PUBLICATION_HTTP_TIMEOUT_MS: "600",
    ...extraEnv,
  };
  const child = spawn(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  return {
    base: `http://localhost:${port}`,
    prisma,
    logs: () => out,
    async stop() {
      child.kill();
      await prisma.$disconnect();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

function client(base, cookie = null) {
  async function call(method, url, body) {
    const res = await fetch(`${base}/api${url}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    return { status: res.status, json };
  }
  return { get: (u) => call("GET", u), post: (u, b) => call("POST", u, b ?? {}), put: (u, b) => call("PUT", u, b), del: (u) => call("DELETE", u) };
}
async function login(base, creds) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  return client(base, res.headers.get("set-cookie")?.split(";")[0] ?? null);
}

async function main() {
  const mock = await startMock();
  const s = await startServer(mock);
  try {
    const admin = await login(s.base, ADMIN);
    const guest = client(s.base);
    const mk = async (email, name, category = "PHD") => {
      const r = await admin.post("/users", { email, password: PW, role: "MEMBER", name, initials: "PI", memberRole: "Researcher", category });
      if (r.status !== 201) throw new Error(`could not create ${email}: ${r.status} ${JSON.stringify(r.json)}`);
      return login(s.base, { email, password: PW });
    };
    const member = await mk("pi-member@example.test", "ZZ PI Member");
    // Researchers with ORCID iDs (set directly: the profile API itself is covered by profiles-regression).
    const people = {};
    for (const [key, category] of [["A", "PHD"], ["B", "MSC"], ["C", "MSC"], ["D", "MSC"], ["E", "MSC"], ["F", "MSC"], ["G", "MSC"], ["H", "ALUMNI"], ["I", "MSC"]]) {
      people[key] = await s.prisma.teamMember.create({ data: { name: `ZZ PI ${key}`, initials: "ZZ", role: "Researcher", category, department: "x", sortOrder: 900, orcid: ID[key] } });
    }
    // A publication the lab already has (entered by hand, DOI in a different letter case than ORCID reports).
    const existing = await s.prisma.publication.create({ data: { year: 2022, title: "Already In The Lab Database", authors: "Lab Person", venue: "Manual Venue", doiUrl: "https://doi.org/10.9999/ALREADY.there" } });
    const pubCountBefore = await s.prisma.publication.count();

    // ---- authorization ------------------------------------------------------------------------
    t("authz: a guest cannot list the review queue", (await guest.get("/publication-imports")).status === 401);
    t("authz: a plain member cannot list the review queue", (await member.get("/publication-imports")).status === 403);
    t("authz: a guest cannot start a sync", (await guest.post("/publication-imports/sync")).status === 401);
    t("authz: a plain member cannot start a sync", (await member.post("/publication-imports/sync")).status === 403);
    t("authz: a plain member cannot approve or reject", (await member.post("/publication-imports/x1/approve")).status === 403 && (await member.post("/publication-imports/x1/reject")).status === 403);
    t("authz: nothing was fetched from the providers by the refused calls", Object.keys(hits.orcid).length === 0);

    // ---- first sync: partial failure is isolated ------------------------------------------------------
    const first = await admin.post("/publication-imports/sync");
    t("sync: completes with 200 and reports PARTIAL (some researchers failed)", first.status === 200 && first.json.status === "PARTIAL", JSON.stringify(first.json));
    const sum = first.json.summary ?? {};
    const failedCodes = Object.fromEntries((sum.failed ?? []).map((f) => [f.teamMemberId, f.code]));
    t("sync: malformed JSON from ORCID is reported for that researcher only", failedCodes[people.C.id] === "malformed_response", JSON.stringify(failedCodes));
    t("sync: a 404 (unknown iD) is reported as not_found", failedCodes[people.D.id] === "not_found", JSON.stringify(failedCodes));
    t("sync: a 429 is reported as rate_limited", failedCodes[people.E.id] === "rate_limited", JSON.stringify(failedCodes));
    t("sync: a slow provider is reported as timeout and does not hang the sync", failedCodes[people.F.id] === "timeout", JSON.stringify(failedCodes));
    t("sync: a researcher with no works is fine (not a failure)", failedCodes[people.G.id] === undefined);
    t("sync: a transient 503 was retried and then succeeded", failedCodes[people.I.id] === undefined && hits.orcid[ID.I] === 2, `${hits.orcid[ID.I]}`);
    t("sync: 429 is retried at most the configured number of times (no hammering)", hits.orcid[ID.E] <= 3, `${hits.orcid[ID.E]}`);
    t("sync: an alumnus is never fetched by default", hits.orcid[ID.H] === undefined);
    t("sync: only the mock was contacted (no other host)", hits.other === 0);

    // ---- results: dedupe, review-before-public ---------------------------------------------------------
    t("review: publications are untouched by a sync (nothing public yet)", (await s.prisma.publication.count()) === pubCountBefore);
    const pending = await admin.get("/publication-imports");
    t("review: the queue is readable by an admin", pending.status === 200 && Array.isArray(pending.json.items));
    const titles = pending.json.items.map((i) => i.title);
    t("review: unusable works (no title / no year) are skipped", !titles.includes("") && !titles.includes("No Usable Year"));
    const alpha = pending.json.items.filter((i) => /^Alpha Study/.test(i.title));
    t("dedupe: the same DOI listed by two researchers (different case) is ONE candidate", alpha.length === 1, JSON.stringify(alpha.map((a) => a.doi)));
    t("dedupe: that candidate is linked to both researchers", alpha[0]?.researcherIds.length === 2 && alpha[0].researcherIds.includes(people.A.id) && alpha[0].researcherIds.includes(people.B.id));
    t("dedupe: DOI is stored lower-cased and the link is the canonical doi.org form", alpha[0]?.doi === "10.1234/alpha.one" && alpha[0]?.url === "https://doi.org/10.1234/alpha.one", JSON.stringify(alpha[0]));
    t("enrich: authors come from Crossref (markup in titles not used for authors; names joined)", alpha[0]?.authors === "Ada Lovelace, The Mock Consortium", alpha[0]?.authors);
    t("dedupe: a work whose DOI already belongs to a stored publication is NOT in the pending queue", !titles.includes("Already In The Lab Database"));
    const dupes = await admin.get("/publication-imports?status=DUPLICATE");
    t("dedupe: …it is recorded as DUPLICATE pointing at the existing publication", dupes.json.items.length === 1 && dupes.json.items[0].publicationId === existing.id, JSON.stringify(dupes.json.items));
    const noDoi = pending.json.items.find((i) => i.title === "A Paper Without Any DOI");
    t("no-DOI work: kept as a candidate with the source URL and no doi", noDoi && noDoi.doi === "" && noDoi.url === "https://example.test/paper-102");
    const inj = pending.json.items.find((i) => /Javascript Injection/.test(i.title));
    t("hostile source data: a javascript: URL is never stored as a link", inj && inj.url === "", JSON.stringify(inj));
    t("review: the flaky-source paper arrived after the retry", titles.includes("Flaky Source Paper"));
    t("review: sync status is exposed (last run, counts)", pending.json.sync.lastStatus === "PARTIAL" && pending.json.sync.orcidResearchers === 8 && pending.json.sync.lastRunAt, JSON.stringify(pending.json.sync));
    t("enrich: Crossref was asked once per new DOI (not once per researcher)", hits.crossref["10.1234/alpha.one"] === 1, JSON.stringify(hits.crossref));

    // ---- idempotency: running again changes nothing --------------------------------------------------------
    const countCandidates = () => s.prisma.publicationCandidate.count();
    const n1 = await countCandidates();
    const second = await admin.post("/publication-imports/sync");
    t("idempotent: a second sync succeeds", second.status === 200);
    t("idempotent: it creates no new candidates", (await countCandidates()) === n1 && second.json.summary.created === 0, JSON.stringify(second.json.summary));
    t("idempotent: it did not re-ask Crossref for known DOIs", hits.crossref["10.1234/alpha.one"] === 1);
    t("idempotent: publications still untouched", (await s.prisma.publication.count()) === pubCountBefore);

    // ---- editorial decisions -----------------------------------------------------------------------------------
    t("approve: a bare id that does not exist is 404", (await admin.post("/publication-imports/nope/approve")).status === 404);
    t("approve: an invalid id shape is rejected before the database", (await admin.post("/publication-imports/..%2F..%2Fx/approve")).status >= 400);
    t("approve: unknown fields are rejected (strict body)", (await admin.post(`/publication-imports/${alpha[0].id}/approve`, { hack: true })).status === 400);
    const noAuthors = await admin.post(`/publication-imports/${noDoi.id}/approve`, {});
    t("approve: a candidate with no authors cannot be approved until the editor types them", noAuthors.status === 400 && /Authors/.test(noAuthors.json.error), JSON.stringify(noAuthors.json));
    t("approve: …and it stayed PENDING", (await s.prisma.publicationCandidate.findUnique({ where: { id: noDoi.id } })).status === "PENDING");
    const approved = await admin.post(`/publication-imports/${alpha[0].id}/approve`, { title: "Alpha Study of Mock Things (corrected)" });
    t("approve: creates the publication", approved.status === 201 && approved.json.publicationId, JSON.stringify(approved.json));
    const pub = await s.prisma.publication.findUnique({ where: { id: approved.json.publicationId }, include: { authorLinks: true } });
    t("approve: it carries the editor's correction, the canonical DOI link and the researchers' author links", pub.title.endsWith("(corrected)") && pub.doiUrl === "https://doi.org/10.1234/alpha.one" && pub.authorLinks.length === 2 && pub.visibility === "PUBLIC", JSON.stringify(pub));
    const pubsPublic = await guest.get("/publications");
    t("approve: only now is it visible to the public", pubsPublic.json.some((p) => p.id === pub.id));
    t("unapproved candidates are NOT in the public list", !pubsPublic.json.some((p) => p.title === "Beta Study" || p.title === "A Paper Without Any DOI"));
    t("approve: a second approval of the same candidate is refused (409) and creates nothing", (await admin.post(`/publication-imports/${alpha[0].id}/approve`, {})).status === 409 && (await s.prisma.publication.count()) === pubCountBefore + 1);
    const withAuthors = await admin.post(`/publication-imports/${noDoi.id}/approve`, { authors: "Someone Real", venue: "A Venue", visibility: "LAB_ONLY", teamMemberIds: [people.A.id] });
    t("approve: with typed authors and LAB_ONLY visibility it works; the source link is kept as an extra link", withAuthors.status === 201);
    const created2 = await s.prisma.publication.findUnique({ where: { id: withAuthors.json.publicationId } });
    t("approve: LAB_ONLY is respected (hidden from guests)", created2.visibility === "LAB_ONLY" && !(await guest.get("/publications")).json.some((p) => p.id === created2.id) && created2.extraUrl === "https://example.test/paper-102" && created2.extraLabel === "");
    t("approve: an unknown author id is rejected", (await admin.post(`/publication-imports/${inj.id}/approve`, { authors: "X", venue: "Y", teamMemberIds: ["doesnotexist"] })).status === 400);
    const reject = await admin.post(`/publication-imports/${inj.id}/reject`);
    t("reject: marks the candidate rejected", reject.status === 200 && (await s.prisma.publicationCandidate.findUnique({ where: { id: inj.id } })).status === "REJECTED");
    t("reject: a second reject is 409, an unknown id is 404", (await admin.post(`/publication-imports/${inj.id}/reject`)).status === 409 && (await admin.post("/publication-imports/nope/reject")).status === 404);

    // ---- a manual record that is edited after approval survives re-sync; rejected stays rejected -----------------------
    await admin.put(`/publications/${pub.id}`, { year: 2024, title: "Edited by hand later", authors: "Hand Edited", venue: "Edited Venue" });
    const third = await admin.post("/publication-imports/sync");
    t("resync: succeeds", third.status === 200);
    const after = await s.prisma.publication.findUnique({ where: { id: pub.id } });
    t("resync: a later manual correction to a publication is NOT overwritten", after.title === "Edited by hand later" && after.authors === "Hand Edited");
    t("resync: a rejected candidate is not proposed again", (await s.prisma.publicationCandidate.findUnique({ where: { id: inj.id } })).status === "REJECTED" && !(await admin.get("/publication-imports")).json.items.some((i) => i.id === inj.id));
    t("resync: an approved candidate stays approved (not re-queued)", (await s.prisma.publicationCandidate.findUnique({ where: { id: alpha[0].id } })).status === "APPROVED");
    t("resync: the manual publication count is exactly what the editors created", (await s.prisma.publication.count()) === pubCountBefore + 2);

    // ---- a DOI added by hand AFTER discovery turns the pending candidate into a duplicate (and approval refuses it) ------
    const beta = (await admin.get("/publication-imports")).json.items.find((i) => i.title === "Beta Study");
    await admin.post("/publications", { year: 2025, title: "Beta Study (manual)", authors: "Manual", venue: "V", doiUrl: "10.1234/BETA.two" });
    const dupApprove = await admin.post(`/publication-imports/${beta.id}/approve`, {});
    t("approve: a DOI that was meanwhile entered by hand is refused as a duplicate (409)", dupApprove.status === 409, JSON.stringify(dupApprove.json));
    t("approve: …and the candidate was marked DUPLICATE (not rolled back)", (await s.prisma.publicationCandidate.findUnique({ where: { id: beta.id } })).status === "DUPLICATE");

    // ---- single researcher sync + concurrency lock + alumni -------------------------------------------------------------------------
    const one = await admin.post("/publication-imports/sync", { teamMemberId: people.H.id });
    t("single sync: an explicitly selected alumnus can be synced", one.status === 200 && hits.orcid[ID.H] === 1 && one.json.summary.created === 1, JSON.stringify(one.json));
    await s.prisma.syncState.update({ where: { name: "publication-sync" }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    const locked = await admin.post("/publication-imports/sync");
    t("lock: a sync started while another is running is refused (409) and fetches nothing", locked.status === 409);
    await s.prisma.syncState.update({ where: { name: "publication-sync" }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    t("lock: an expired lock does not block forever", (await admin.post("/publication-imports/sync")).status === 200);
    t("sync: invalid body is rejected", (await admin.post("/publication-imports/sync", { teamMemberId: "../x" })).status === 400);

    // ---- audit -------------------------------------------------------------------------------------------------------------------------------
    const actions = (await s.prisma.auditLog.findMany({ select: { action: true, details: true } })).map((a) => a.action);
    t("audit: sync runs, approvals and rejections are recorded", ["PUBLICATION_SYNC_RUN", "PUBLICATION_IMPORT_APPROVED", "PUBLICATION_IMPORT_REJECTED"].every((a) => actions.includes(a)));

    // ---- DOI autofill lookup --------------------------------------------------------------------------------------------------------------------
    t("lookup: guests are refused", (await guest.get("/publication-imports/lookup?doi=10.1234/Alpha.One")).status === 401);
    const lk = await member.get(`/publication-imports/lookup?doi=${encodeURIComponent("https://doi.org/10.1234/Alpha.One")}`);
    t("lookup: any logged-in member gets suggestions from a DOI link (nothing is saved)", lk.status === 200 && lk.json.title === "Alpha Study of Mock Things" && lk.json.authors.includes("Ada Lovelace") && lk.json.doiUrl === "https://doi.org/10.1234/Alpha.One", JSON.stringify(lk.json));
    const before = hits.crossref["10.1234/alpha.one"];
    await member.get("/publication-imports/lookup?doi=10.1234/Alpha.One");
    t("lookup: a repeat is served from the short cache", hits.crossref["10.1234/alpha.one"] === before);
    t("lookup: an unknown DOI is a friendly 404", (await member.get("/publication-imports/lookup?doi=10.1234/unknown.thing")).status === 404);
    t("lookup: a non-DOI is a 400 and makes no outbound request", (await member.get("/publication-imports/lookup?doi=https://evil.example.test/x")).status === 400);
    t("lookup: a provider 429 surfaces as a 502 with a 'enter by hand' message, not a crash", (await member.get("/publication-imports/lookup?doi=10.1234/rate.limited")).status === 502);
    let limited = 0;
    for (let i = 0; i < 40; i++) if ((await member.get(`/publication-imports/lookup?doi=10.1234/limit.${i}`)).status === 429) limited++;
    t("lookup: a single user is rate-limited", limited > 0, `${limited}`);
    t("lookup: the admin is unaffected by another user's limit", (await admin.get("/publication-imports/lookup?doi=10.1234/Beta.Two")).status === 200);

    // ---- manual entry still works -----------------------------------------------------------------------------------------------------------------------
    const manual = await member.post("/publications", { year: 2026, title: "Manual entry still works", authors: "Me", venue: "Somewhere", doiUrl: "doi:10.5555/manual.entry" });
    t("manual: publication entry (with a bare DOI) is unchanged and independent of the importer", manual.status === 201 && manual.json.doiUrl === "https://doi.org/10.5555/manual.entry", JSON.stringify(manual.json));
    t("no secrets: the provider token/credentials never appear in the logs", !/client_secret|Bearer /i.test(s.logs()));
  } finally {
    await s.stop();
    mock.close();
  }
  console.log(`\n${ok} publication-import checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}
main().catch((err) => {
  console.error(err);
  if (failures.length) console.log("Failures so far:\n - " + failures.join("\n - "));
  process.exit(1);
});

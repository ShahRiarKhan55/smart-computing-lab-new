/**
 * Unit test of the blob-cleanup decision after a failed gallery transaction (src/lib/galleryBlobCleanup.ts).
 * Pure logic with fake dependencies: no database, no storage, no network.   npm run test:unit -w apps/server
 *
 * The rule under test: delete the uploaded blob ONLY when the transaction callback never completed (so no
 * commit can have been issued); once the callback completed, a reported error may still be a committed
 * transaction (the outcome is uncertain), so the blob is kept.
 */
import { releaseUploadedBlob, type BlobCleanupDeps } from "../src/lib/galleryBlobCleanup.ts";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

function fakes(over: Partial<BlobCleanupDeps> = {}) {
  const removed: string[] = [];
  const logs: string[] = [];
  let lookups = 0;
  const deps: BlobCleanupDeps = {
    isReferenced: async () => {
      lookups++;
      return false;
    },
    remove: async (k) => void removed.push(k),
    log: (m) => void logs.push(m),
    ...over,
  };
  return { deps, removed, logs, lookups: () => lookups };
}

// ---- the callback never completed (it threw / the transaction never started): no commit, safe to delete -------------------
{
  const f = fakes();
  const r = await releaseUploadedBlob("key-1", false, f.deps);
  t("no commit attempted -> the blob is removed", r === "removed" && f.removed.join() === "key-1");
  t("... without needing the database (it may be the very thing that failed)", f.lookups() === 0);
}
{
  const f = fakes({ remove: async () => { throw new Error("blob service down"); } });
  let threw = false;
  let r = "";
  try { r = await releaseUploadedBlob("key-2", false, f.deps); } catch { threw = true; }
  t("a failing removal never throws (it must not mask the request's own error)", !threw && r === "remove-failed");
  t("... but it is logged", f.logs.length === 1 && f.logs[0].includes("key-2"));
}
{
  const f = fakes({ isReferenced: async () => { throw new Error("must not be consulted"); } });
  const r = await releaseUploadedBlob("key-3", false, f.deps);
  t("no commit attempted + unreachable database -> still removed (the rollback is certain)", r === "removed");
}

// ---- the callback completed and the transaction then reported an error: outcome uncertain, never delete -----------------------------------------
{
  const f = fakes({ isReferenced: async () => true });
  const r = await releaseUploadedBlob("key-4", true, f.deps);
  t("commit attempted + a row references the blob -> KEPT (it was committed)", r === "kept-committed" && f.removed.length === 0);
  t("... and the log says the upload was committed", f.logs.some((m) => /committed/.test(m) && m.includes("key-4")));
}
{
  const f = fakes({ isReferenced: async () => false });
  const r = await releaseUploadedBlob("key-5", true, f.deps);
  t("commit attempted + no row yet -> KEPT (a late-applied commit must not lose its image)", r === "kept-unknown" && f.removed.length === 0);
}
{
  const f = fakes({ isReferenced: async () => { throw new Error("database unreachable"); } });
  let threw = false;
  let r = "";
  try { r = await releaseUploadedBlob("key-6", true, f.deps); } catch { threw = true; }
  t("commit attempted + the check itself fails -> KEPT, and nothing is thrown", !threw && r === "kept-check-failed" && f.removed.length === 0);
}
{
  const f = fakes({ remove: async () => { throw new Error("remove must never be called here"); }, isReferenced: async () => true });
  let r = "";
  try { r = await releaseUploadedBlob("key-7", true, f.deps); } catch { r = "threw"; }
  t("commit attempted: remove() is never even invoked", r === "kept-committed");
}
{
  const f = fakes({ isReferenced: async () => { throw Object.assign(new Error("boom"), { secret: "s3cr3t" }); } });
  await releaseUploadedBlob("key-8", true, f.deps);
  t("log lines name the storage key only (no error text, no secrets)", f.logs.every((m) => !m.includes("s3cr3t") && !m.includes("boom")));
}

console.log(`${ok} gallery blob-cleanup unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

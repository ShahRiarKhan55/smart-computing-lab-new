/**
 * Unit test of the Gallery multi-image batch logic (packages/shared/src/galleryBatch.ts): selection
 * planning (count/type/size), the sequential runner (partial success, stop on 401/503, cancel) and
 * retry selection. Pure logic: no server, no database, no network.   npm run test:unit -w apps/server
 */
import {
  DEFAULT_IMAGE_MAX_BYTES,
  DICTIONARIES,
  GALLERY_BATCH_MAX_FILES,
  GALLERY_BATCH_MAX_IMAGE_BYTES,
  GALLERY_BATCH_STOP_STATUSES,
  batchProgress,
  batchSubmitAction,
  pendingBatchIds,
  planGallerySelection,
  retryableBatchIds,
  runGalleryBatch,
  type BatchStatus,
} from "@scl/shared";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

const img = (name: string, size = 1000, type = "image/jpeg") => ({ name, size, type });
const many = (n: number, prefix = "p") => Array.from({ length: n }, (_, i) => img(`${prefix}${i}.jpg`));
const httpError = (status: number, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });

// ---- constants ---------------------------------------------------------------------------
t("batch limit is 10 images", GALLERY_BATCH_MAX_FILES === 10);
t("client-side per-image limit is 4 MB", GALLERY_BATCH_MAX_IMAGE_BYTES === 4 * 1024 * 1024);
t("the 4 MB limit sits below Vercel's 4.5 MB request payload limit (multipart overhead also counts)", GALLERY_BATCH_MAX_IMAGE_BYTES < 4.5 * 1024 * 1024);
t("the SERVER image limit is unchanged at 5 MB (the client limit is deliberately stricter)", DEFAULT_IMAGE_MAX_BYTES === 5 * 1024 * 1024 && GALLERY_BATCH_MAX_IMAGE_BYTES < DEFAULT_IMAGE_MAX_BYTES);
t("stop statuses are exactly 401 and 503", GALLERY_BATCH_STOP_STATUSES.length === 2 && GALLERY_BATCH_STOP_STATUSES.includes(401) && GALLERY_BATCH_STOP_STATUSES.includes(503));

// ---- planGallerySelection ------------------------------------------------------------------
{
  const one = planGallerySelection(0, [img("a.jpg")]);
  t("selecting 1 valid file accepts it", one.accepted.length === 1 && one.rejected.length === 0);

  const ten = planGallerySelection(0, many(10));
  t("selecting exactly 10 valid files accepts all 10", ten.accepted.length === 10 && ten.rejected.length === 0);

  const eleven = planGallerySelection(0, many(11));
  t("selecting 11 accepts the first 10 in order and rejects the 11th as batchFull",
    eleven.accepted.length === 10 && eleven.accepted[9].name === "p9.jpg" && eleven.rejected.length === 1 && eleven.rejected[0].reason === "batchFull" && eleven.rejected[0].file.name === "p10.jpg");

  const topUp = planGallerySelection(7, many(5));
  t("with 7 already chosen, only 3 more fit and 2 are rejected as batchFull", topUp.accepted.length === 3 && topUp.rejected.length === 2 && topUp.rejected.every((r) => r.reason === "batchFull"));

  const full = planGallerySelection(10, [img("x.jpg")]);
  t("with 10 already chosen, nothing more is accepted", full.accepted.length === 0 && full.rejected[0]?.reason === "batchFull");

  const none = planGallerySelection(0, []);
  t("an empty selection yields nothing", none.accepted.length === 0 && none.rejected.length === 0);

  for (const type of ["application/pdf", "image/svg+xml", "text/html", "", "image/bmp"]) {
    const r = planGallerySelection(0, [img("f", 10, type)]);
    t(`unsupported type "${type}" is rejected as unsupportedType`, r.accepted.length === 0 && r.rejected[0]?.reason === "unsupportedType");
  }
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
    t(`${type} is accepted`, planGallerySelection(0, [img("f", 10, type)]).accepted.length === 1);
  }

  t("an image of exactly 4 MB is accepted", planGallerySelection(0, [img("edge.jpg", GALLERY_BATCH_MAX_IMAGE_BYTES)]).accepted.length === 1);
  const big = planGallerySelection(0, [img("big.jpg", GALLERY_BATCH_MAX_IMAGE_BYTES + 1)]);
  t("an image 1 byte over 4 MB is rejected as tooLarge", big.accepted.length === 0 && big.rejected[0]?.reason === "tooLarge");
  const midSize = planGallerySelection(0, [img("mid.jpg", 4.5 * 1024 * 1024), img("five.jpg", DEFAULT_IMAGE_MAX_BYTES)]);
  t("images of 4.5 MB and 5 MB (which the server alone would accept) are rejected client-side as tooLarge", midSize.accepted.length === 0 && midSize.rejected.every((r) => r.reason === "tooLarge"));

  const mixed = planGallerySelection(0, [img("ok1.jpg"), img("doc.pdf", 10, "application/pdf"), img("huge.png", DEFAULT_IMAGE_MAX_BYTES * 2, "image/png"), img("ok2.png", 10, "image/png")]);
  t("a mixed selection keeps the valid files and reports each rejection with its reason",
    mixed.accepted.map((f) => f.name).join() === "ok1.jpg,ok2.png" && mixed.rejected.map((r) => `${r.file.name}:${r.reason}`).join() === "doc.pdf:unsupportedType,huge.png:tooLarge");

  const invalidDoesNotUseSlot = planGallerySelection(9, [img("bad.pdf", 10, "application/pdf"), img("good.jpg")]);
  t("an invalid file never consumes a batch slot", invalidDoesNotUseSlot.accepted.length === 1 && invalidDoesNotUseSlot.accepted[0].name === "good.jpg" && invalidDoesNotUseSlot.rejected[0].reason === "unsupportedType");

  const custom = planGallerySelection(0, many(3), { maxFiles: 2, maxBytes: 5000 });
  t("custom limits are honoured", custom.accepted.length === 2 && custom.rejected.length === 1);
}

// ---- runGalleryBatch -----------------------------------------------------------------------
type Event = { id: string; status: BatchStatus; httpStatus?: number; message?: string };
async function run(ids: string[], behaviour: Record<string, () => Promise<void> | void>, shouldCancel?: () => boolean) {
  const events: Event[] = [];
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const outcome = await runGalleryBatch(
    ids,
    async (id) => {
      calls.push(id);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      try {
        await (behaviour[id] ?? (() => undefined))();
      } finally {
        inFlight--;
      }
    },
    (id, status, detail) => events.push({ id, status, ...detail }),
    shouldCancel,
  );
  return { outcome, events, calls, maxInFlight };
}
const final = (events: Event[], id: string) => [...events].reverse().find((e) => e.id === id)?.status;

{
  const r = await run(["a", "b", "c"], {});
  t("all succeed: outcome counts 3/0/0 and no stop", r.outcome.succeeded === 3 && r.outcome.failed === 0 && r.outcome.cancelled === 0 && r.outcome.stoppedBy === null);
  t("uploads run strictly sequentially (never more than one in flight)", r.maxInFlight === 1);
  t("uploads run in the given order", r.calls.join() === "a,b,c");
  t("each file reports uploading then succeeded", ["a", "b", "c"].every((id) => r.events.filter((e) => e.id === id).map((e) => e.status).join() === "uploading,succeeded"));
}
{
  const r = await run(["a", "b", "c", "d"], { b: () => { throw httpError(400, "Unsupported or unrecognised file type."); }, c: () => { throw httpError(413); } });
  t("individual 400/413 errors do not stop the batch: later files are still uploaded", r.calls.join() === "a,b,c,d");
  t("partial success is reported: 2 succeeded, 2 failed, 0 cancelled, no stop", r.outcome.succeeded === 2 && r.outcome.failed === 2 && r.outcome.cancelled === 0 && r.outcome.stoppedBy === null);
  t("failed files carry their HTTP status and message", r.events.some((e) => e.id === "b" && e.status === "failed" && e.httpStatus === 400 && /Unsupported/.test(e.message ?? "")) && r.events.some((e) => e.id === "c" && e.status === "failed" && e.httpStatus === 413));
}
{
  const r = await run(["a", "b", "c", "d"], { b: () => { throw httpError(401); } });
  t("401 stops the batch: the file after the failure is never sent", r.calls.join() === "a,b");
  t("401: the failing file is failed, the rest are cancelled, stoppedBy=401", final(r.events, "b") === "failed" && final(r.events, "c") === "cancelled" && final(r.events, "d") === "cancelled" && r.outcome.stoppedBy === 401);
  t("401: outcome counts 1 succeeded, 1 failed, 2 cancelled", r.outcome.succeeded === 1 && r.outcome.failed === 1 && r.outcome.cancelled === 2);
}
{
  const r = await run(["a", "b", "c"], { a: () => { throw httpError(503, "File storage is not available right now."); } });
  t("503 on the first file stops everything: only one request is made", r.calls.join() === "a");
  t("503: first file failed, the others cancelled, stoppedBy=503", final(r.events, "a") === "failed" && final(r.events, "b") === "cancelled" && final(r.events, "c") === "cancelled" && r.outcome.stoppedBy === 503);
}
{
  const r = await run(["a", "b"], { a: () => { throw new TypeError("Failed to fetch"); } });
  t("a network error (no HTTP status) fails that file only and the batch continues", r.calls.join() === "a,b" && final(r.events, "a") === "failed" && final(r.events, "b") === "succeeded" && r.outcome.stoppedBy === null);
  t("a non-HTTP failure reports no httpStatus", r.events.find((e) => e.id === "a" && e.status === "failed")?.httpStatus === undefined);
}
{
  const r = await run(["a", "b", "c"], { b: () => { throw httpError(500); } });
  t("a 500 on one file is an individual failure (batch continues)", r.calls.join() === "a,b,c" && r.outcome.failed === 1 && r.outcome.stoppedBy === null);
}
{
  let cancel = false;
  const r = await run(["a", "b", "c", "d"], { a: () => { cancel = true; } }, () => cancel);
  t("user cancel: the in-flight file completes, the remaining files are cancelled and never sent", r.calls.join() === "a" && final(r.events, "a") === "succeeded" && final(r.events, "b") === "cancelled" && final(r.events, "d") === "cancelled");
  t("user cancel: outcome counts 1 succeeded, 3 cancelled, no stop status", r.outcome.succeeded === 1 && r.outcome.cancelled === 3 && r.outcome.stoppedBy === null);
}
{
  const r = await run([], {});
  t("an empty batch does nothing", r.calls.length === 0 && r.outcome.succeeded === 0 && r.outcome.stoppedBy === null);
}

// ---- retryableBatchIds: retry only what has not succeeded ----------------------------------
{
  const entries: { id: string; status: BatchStatus }[] = [
    { id: "a", status: "succeeded" },
    { id: "b", status: "failed" },
    { id: "c", status: "cancelled" },
    { id: "d", status: "waiting" },
    { id: "e", status: "uploading" },
    { id: "f", status: "succeeded" },
  ];
  t("retry selects failed and cancelled files, in order", retryableBatchIds(entries).join() === "b,c");
  t("retry never includes a succeeded file", !retryableBatchIds(entries).includes("a") && !retryableBatchIds(entries).includes("f"));
  t("retry excludes files that are waiting or currently uploading", !retryableBatchIds(entries).includes("d") && !retryableBatchIds(entries).includes("e"));
  t("nothing to retry when everything succeeded", retryableBatchIds([{ id: "a", status: "succeeded" }]).length === 0);
  t("pending (upload/retry click) = waiting + failed + cancelled in list order, never succeeded or uploading", pendingBatchIds(entries).join() === "b,c,d");
  t("a fresh batch (all waiting) has every file pending", pendingBatchIds([{ id: "x", status: "waiting" }, { id: "y", status: "waiting" }]).join() === "x,y");
}
{
  // End to end: first pass fails on 503, retry of only the not-succeeded files uploads exactly those.
  const status = new Map<string, BatchStatus>([["a", "waiting"], ["b", "waiting"], ["c", "waiting"]]);
  const uploads: string[] = [];
  let storageUp = false;
  const upload = async (id: string) => {
    uploads.push(id);
    if (id === "b" && !storageUp) throw httpError(503);
  };
  const onStatus = (id: string, s: BatchStatus) => status.set(id, s);
  await runGalleryBatch(["a", "b", "c"], upload, onStatus);
  t("first pass: a uploaded, b hit 503, c was cancelled unsent", uploads.join() === "a,b" && status.get("a") === "succeeded" && status.get("b") === "failed" && status.get("c") === "cancelled");
  storageUp = true;
  const retryIds = retryableBatchIds([...status].map(([id, s]) => ({ id, status: s })));
  await runGalleryBatch(retryIds, upload, onStatus);
  t("retry uploads only b and c; the already-succeeded a is NOT uploaded again", uploads.join() === "a,b,b,c" && [...status.values()].every((s) => s === "succeeded"));
}

// ---- batchProgress ---------------------------------------------------------------------------
{
  const mk = (...st: BatchStatus[]) => st.map((status, i) => ({ id: `e${i}`, status }));
  const ids = ["e0", "e1", "e2", "e3"];
  const p0 = batchProgress(mk("uploading", "waiting", "waiting", "waiting"), ids);
  t("progress: first file uploading of 4 -> current 1, done 0, total 4", p0.current === 1 && p0.done === 0 && p0.total === 4);
  const p2 = batchProgress(mk("succeeded", "failed", "uploading", "waiting"), ids);
  t("progress: two finished (one failed) -> current 3 of 4", p2.current === 3 && p2.done === 2 && p2.total === 4);
  const pAll = batchProgress(mk("succeeded", "succeeded", "succeeded", "succeeded"), ids);
  t("progress: everything finished -> current never exceeds total", pAll.current === 4 && pAll.done === 4);
  const pRetry = batchProgress(mk("succeeded", "succeeded", "uploading", "waiting"), ["e2", "e3"]);
  t("progress counts only the files in THIS run (a retry of 2 reads 1 of 2, not 3 of 4)", pRetry.total === 2 && pRetry.done === 0 && pRetry.current === 1);
  t("progress for an empty run is 0 of 0", batchProgress([], []).total === 0 && batchProgress([], []).current === 0);
  const pCancel = batchProgress(mk("succeeded", "cancelled", "cancelled", "cancelled"), ids);
  t("cancelled files count as finished for progress", pCancel.done === 4);
}

// ---- batchSubmitAction: the button label must match what a click actually sends -----------------
{
  const mk = (...st: BatchStatus[]) => st.map((status, i) => ({ id: `e${i}`, status }));
  t("action: nothing selected -> none", batchSubmitAction([]) === "none");
  t("action: all waiting -> upload", batchSubmitAction(mk("waiting", "waiting")) === "upload");
  t("action: only failed/cancelled remain -> retry", batchSubmitAction(mk("succeeded", "failed", "cancelled")) === "retry");
  t("action: failed files PLUS newly added waiting files -> uploadRemaining (not 'retry': the click also sends the new files)", batchSubmitAction(mk("succeeded", "failed", "waiting")) === "uploadRemaining");
  t("action: succeeded + waiting after a finished run -> uploadRemaining", batchSubmitAction(mk("succeeded", "waiting")) === "uploadRemaining");
  t("action: everything succeeded -> none (nothing left to send)", batchSubmitAction(mk("succeeded", "succeeded")) === "none");
  // consistency: the action is 'none' exactly when a click would send nothing; 'retry' never coexists with a waiting file
  const cases: BatchStatus[][] = [["waiting"], ["failed"], ["cancelled", "waiting"], ["succeeded"], ["failed", "waiting", "succeeded"], ["uploading", "waiting"]];
  t("action/ids consistency: 'none' <=> no pending ids; 'retry' <=> pending ids contain no waiting file",
    cases.every((c) => {
      const e = mk(...c);
      const pending = pendingBatchIds(e);
      const a = batchSubmitAction(e);
      const hasWaiting = e.some((x) => x.status === "waiting");
      return (a === "none") === (pending.length === 0) && (a !== "retry" || !hasWaiting);
    }));
}

// ---- translations for the batch UI ------------------------------------------------------------
{
  const NEW_KEYS = ["gallery.progress", "gallery.uploadRemaining", "gallery.retryRemaining", "gallery.uploadCount", "gallery.batchHint", "gallery.batchStoppedUnavailable", "gallery.batchStoppedAuth", "gallery.batchSummary"] as const;
  for (const lang of ["en", "ja"] as const) {
    const d = DICTIONARIES[lang] as Record<string, string>;
    t(`${lang}: all batch UI keys exist and are non-empty`, NEW_KEYS.every((k) => typeof d[k] === "string" && d[k].length > 0));
    t(`${lang}: the progress text interpolates current and total`, d["gallery.progress"].includes("{current}") && d["gallery.progress"].includes("{total}"));
    t(`${lang}: the hint and the too-large message take the limit as {max} (so they follow the 4 MB constant, never a hard-coded size)`,
      d["gallery.batchHint"].includes("{max}") && d["gallery.batchHint"].includes("{maxFiles}") && d["gallery.rejectedTooLarge"].includes("{max}"));
    t(`${lang}: no gallery string hard-codes "5 MB" / "5MB" / "5 ＭＢ"`, !Object.entries(d).some(([k, v]) => k.startsWith("gallery.") && /(^|[^\d.])5\s?MB/i.test(v)));
    t(`${lang}: the 503 message does not claim every 503 is a storage problem or expose internals`,
      !/storage|blob|vercel|token|ストレージ/i.test(d["gallery.batchStoppedUnavailable"]) && d["gallery.batchStoppedUnavailable"].length > 20);
    t(`${lang}: the retry and upload-remaining labels differ`, d["gallery.retryRemaining"] !== d["gallery.uploadRemaining"]);
    for (const dead of ["imageFile", "selected", "unsupportedFileType", "fileTooLargeMax", "addAPhotoTitle", "fileTypesHint", "uploadFailed", "batchStoppedStorage"]) {
      t(`${lang}: the removed key gallery.${dead} is gone`, !(`gallery.${dead}` in d));
    }
  }
  t("en and ja define the same gallery.* keys", JSON.stringify(Object.keys(DICTIONARIES.en).filter((k) => k.startsWith("gallery.")).sort()) === JSON.stringify(Object.keys(DICTIONARIES.ja).filter((k) => k.startsWith("gallery.")).sort()));
}

console.log(`${ok} gallery-batch unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}

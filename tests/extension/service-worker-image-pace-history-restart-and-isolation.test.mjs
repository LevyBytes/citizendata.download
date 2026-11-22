// The image hosts' pace history in the extension (PARSER_HARDENING.md §14, criterion 20): a finished image run handed
// over by the dashboard is kept in a record of its own, survives a worker restart, and folds, past the detailed limit,
// into its own aggregate. The account's pace history is never read, changed or folded with it, and a run record
// that fails the history's checks is refused.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { at, FINGERPRINT, History, plain, settings, small } from "../jobs/pacehistoryundertest.mjs";

const IMAGE_FAMILY = "GET /{image} in images";

function imageRun(runId, startedAt, elapsedMs = [120, 130, 140, 150, 160]) {
  let run = History.startRun({ runId, accountId: "images", runKind: "images", settingsFingerprint: FINGERPRINT, settingsVersion: 1, startedAt, startedFactor: 2 });
  for (const elapsed of elapsedMs) {
    run = History.recordAttempt(run, { section: "images", requestFamily: IMAGE_FAMILY, outcome: "accepted", code: "OK", httpStatus: 200, elapsedMs: elapsed, factor: 2, retried: false }, settings);
    run = History.recordAccepted(run, { requestFamily: IMAGE_FAMILY, elapsedMs: elapsed, factor: 2 }, settings);
  }
  return plain({ ...run, endedAt: startedAt });
}

const withoutImages = (records) => plain(records).filter((record) => record.historyKey !== "images").sort((left, right) => left.historyKey.localeCompare(right.historyKey));

test("an image run is kept apart from the account's history, survives a worker restart, and a malformed one is refused", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  assert.equal((await tab.build()).code, "RUN_STARTED");
  assert.equal((await harness.finishJob()).status, "complete");
  const accountHistory = withoutImages(await harness.repository.listPaceHistory());
  assert.ok(accountHistory.some((record) => record.kind === "run"), "the account build kept its history");
  assert.equal((await tab.request("GET_IMAGE_PACE_HISTORY")).history, null, "no image history yet, and none made of the account's");
  assert.deepEqual(await tab.request("ADD_IMAGE_PACE_RUN", { run: imageRun("image-1", at(1000)) }), { ok: true, runs: 1 });
  // A restarted worker reads the same history.
  harness.stopWorker();
  const kept = (await tab.request("GET_IMAGE_PACE_HISTORY")).history;
  assert.equal(harness.workerRunning(), true);
  assert.deepEqual(plain([kept.historyKey, kept.kind, kept.runs.map((run) => run.runId)]), ["images", "images", ["image-1"]]);
  assert.deepEqual(plain(History.imageNormalLatency(kept, IMAGE_FAMILY, settings)), [120, 130, 140, 150, 160]);
  // The account's records are as the build left them, and its normal times know nothing of the images.
  assert.deepEqual(withoutImages(await harness.repository.listPaceHistory()), accountHistory);
  assert.deepEqual(plain(History.normalLatency(await harness.repository.listPaceHistory(), IMAGE_FAMILY, settings)), []);
  // A run that fails the checks, or is not an image run, is refused, and the history stays as it was.
  const withAddress = { ...imageRun("image-2", at(2000)), latency: { "GET https://media.robertsspaceindustries.com/a.png in images": { samples: [1], fastestAcceptedFactor: 2 } } };
  for (const run of [withAddress, { ...imageRun("image-3", at(3000)), runKind: "account" }, { ...imageRun("image-4", at(4000)), endedAt: null }]) {
    assert.equal((await tab.request("ADD_IMAGE_PACE_RUN", { run })).code, "INVALID_IMAGE_PACE_RUN");
  }
  assert.deepEqual(plain((await tab.request("GET_IMAGE_PACE_HISTORY")).history), plain(kept));
  // A later account build neither reads nor folds the image history.
  assert.equal((await tab.build()).code, "RUN_STARTED");
  assert.equal((await harness.finishJob()).status, "complete");
  assert.deepEqual(plain((await tab.request("GET_IMAGE_PACE_HISTORY")).history), plain(kept));
});

test("two image runs completed together are merged atomically and both survive a worker restart", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const answers = await Promise.all([
    tab.request("ADD_IMAGE_PACE_RUN", { run: imageRun("image-concurrent-a", at(1000), [111]) }),
    tab.request("ADD_IMAGE_PACE_RUN", { run: imageRun("image-concurrent-b", at(2000), [222]) })
  ]);
  assert.deepEqual(plain(answers.map((answer) => answer.runs).sort()), [1, 2]);
  assert.ok(answers.every((answer) => answer.ok === true));
  harness.stopWorker();
  const kept = (await tab.request("GET_IMAGE_PACE_HISTORY")).history;
  assert.deepEqual(plain(kept.runs.map((run) => run.runId)), ["image-concurrent-a", "image-concurrent-b"]);
  assert.deepEqual(plain(History.imagePriorCounts(kept, settings)), { runs: 2, acceptedRequests: 2, refusedRequests: 0, retriedRequests: 0, slowSteps: 0 });
});

test("image runs past the detailed limit fold, oldest first, into the image aggregate without losing a count", () => {
  const bounded = small({ detailedRuns: 2, maximumLatencySamplesPerRequestFamily: 5 });
  let history = null;
  for (let index = 0; index < 4; index += 1) {
    history = History.finishImageRun(history, imageRun(`image-${index}`, at(index * 60000), [100 + index]), { endedAt: at(index * 60000 + 1000) }, bounded);
    assert.equal(History.validateImageHistory(history, bounded), null);
  }
  assert.deepEqual(plain(history.runs.map((run) => run.runId)), ["image-2", "image-3"], "the two newest image runs keep their detail");
  assert.deepEqual(plain([history.aggregate.runs, history.aggregate.acceptedRequests]), [2, 2]);
  assert.deepEqual(plain(History.imagePriorCounts(history, bounded)), { runs: 4, acceptedRequests: 4, refusedRequests: 0, retriedRequests: 0, slowSteps: 0 });
  assert.deepEqual(plain(History.imageNormalLatency(history, IMAGE_FAMILY, bounded)), [100, 101, 102, 103]);
});

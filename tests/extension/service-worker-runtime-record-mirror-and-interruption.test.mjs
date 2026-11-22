// The runtime state has one durable source of truth, the repository's runtime record, stored in one transaction with
// the status revision (PARSER_HARDENING.md §12.5); chrome.storage.local holds a mirror written after it. A worker
// ended before or after the mirror write is restarted from the record: the mirror is written again when it is
// behind, and the revision neither falls nor is used again for another status.
import assert from "node:assert/strict";
import test from "node:test";
import { STATE_KEY } from "../support/extension-harness.mjs";
import { runningBuild } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

// Ends the worker at its next write of the mirror: before that write is stored, or just after it.
function endWorkerAtMirrorWrite(harness, { afterWrite }) {
  const set = harness.local.set.bind(harness.local);
  const ended = { at: null, mirror: null };
  harness.local.set = (name, value) => {
    if (name !== STATE_KEY || ended.at) return set(name, value);
    ended.at = afterWrite ? "after" : "before";
    if (afterWrite) set(name, value);
    ended.mirror = harness.local.get(STATE_KEY)?.status ?? null;
    harness.stopWorker();
    return harness.local;
  };
  return ended;
}

// What each revision was shown with: a revision must never be shown with two different states.
function revisionLedger() {
  const shownWith = new Map();
  return (status) => {
    const shape = JSON.stringify([status.status, status.activeJob?.status ?? null, status.hasActiveJob]);
    const earlier = shownWith.get(status.statusRevision);
    assert.ok(earlier === undefined || earlier === shape, `revision ${status.statusRevision} was shown as ${earlier} and as ${shape}`);
    shownWith.set(status.statusRevision, shape);
    return status.statusRevision;
  };
}

async function pauseInterrupted(afterWrite) {
  const { harness, tab } = await runningBuild({ account: { latencyMs: 300 } }, 7);
  const note = revisionLedger();
  const before = note(await tab.status());
  const ended = endWorkerAtMirrorWrite(harness, { afterWrite });
  // The ended worker never answers the dashboard's request.
  const pausing = tab.request("PAUSE").then(() => "answered", () => "unanswered");
  await harness.advance(() => ended.at !== null);
  assert.equal(harness.workerRunning(), false, "the worker was ended at the mirror write");
  assert.equal(await pausing, "unanswered");
  // The record holds the pause and its raised revision, whatever became of the mirror.
  assert.equal((await harness.repository.getRuntime()).status, "paused");
  const durableRevision = await harness.repository.getStatusRevision();
  assert.ok(durableRevision > before, "the pause raised the revision in the record's own transaction");
  assert.equal(ended.mirror, afterWrite ? "paused" : "running", "the mirror is one change behind only when the worker ended before writing it");
  // The next worker, woken by the dashboard or the watchdog alarm, reads the record and writes the mirror again.
  const restarted = await tab.status();
  assert.equal(harness.workerRunning(), true);
  assert.deepEqual([restarted.status, harness.state().status], ["paused", "paused"]);
  assert.ok(note(restarted) >= durableRevision, "the revision did not fall across the restart");
  const resumed = await tab.request("RESUME");
  assert.equal(resumed.status.status, "running");
  assert.ok(note(resumed.status) > durableRevision, "the next change takes a revision not used before");
  assert.deepEqual([harness.state().status, (await harness.repository.getRuntime()).status], ["running", "running"]);
  assert.equal((await harness.finishJob()).status, "complete");
  note(await tab.status());
}

test("a worker ended before the mirror write restarts from the record and writes the mirror again", async () => {
  await pauseInterrupted(false);
});

test("a worker ended just after the mirror write restarts with the record and the mirror agreeing", async () => {
  await pauseInterrupted(true);
});

test("a mirror without a record, left by an older installation, is read once and stored as the record", async () => {
  const { harness, tab } = await runningBuild({ account: { latencyMs: 300 } }, 7);
  assert.equal((await tab.request("CANCEL")).ok, true);
  const state = harness.state();
  assert.equal((await harness.popup.request("CLEAR_ALL")).ok, true);
  assert.equal(await harness.repository.getRuntime(), undefined);
  harness.stopWorker();
  harness.local.set(STATE_KEY, { ...state, activeJobId: null, status: "idle", lastTerminalJobId: null });
  const status = await tab.status();
  assert.equal((await harness.repository.getRuntime()).status, "idle", "the mirror became the record");
  // Clear All resets the local data store, the revision with it (PARSER_HARDENING.md §12.5); it grows again from there.
  assert.ok(Number.isSafeInteger(status.statusRevision) && status.statusRevision >= 0, `revision ${status.statusRevision}`);
});

import assert from "node:assert/strict";
import test from "node:test";
import { WATCHDOG_ALARM } from "../support/extension-harness.mjs";
import { assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { longestGap, resultOf, runningBuild } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a worker Chrome stopped is restarted by the watchdog alarm and the job finishes with nothing repeated", async () => {
  const { harness, tab } = await runningBuild({ account: { counts: { pledges: 120, buybacks: 900 } } }, 9);
  const alarm = { ...harness.alarms.get(WATCHDOG_ALARM) };
  // The dashboard is closed too, so nothing but the alarm can wake the extension.
  tab.close();
  harness.stopWorker();
  const stoppedAt = harness.clock.now;
  const requestsAtStop = harness.rsi.requests.length;
  await harness.advanceBy(alarm.scheduledTime - stoppedAt - 1);
  assert.equal(harness.rsi.requests.length, requestsAtStop, "a stopped worker requests nothing");
  assert.equal(harness.workerRunning(), false);
  assert.equal(harness.state().status, "running", "the stored job is still marked running");

  await harness.advance(() => harness.rsi.requests.length > requestsAtStop);
  assert.equal(harness.workerStarts, 2);
  const resumedAt = harness.rsi.requests[requestsAtStop].at;
  assert.ok(resumedAt >= alarm.scheduledTime && resumedAt - alarm.scheduledTime < 2000, `collection resumed ${resumedAt - alarm.scheduledTime} ms after the alarm`);
  assert.ok(resumedAt - stoppedAt <= 30000, "the loop is never stopped for longer than one alarm period");

  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete");
  // The slow start's interval is the longest: 1,800 ms and up to 269 ms of jitter, with the margin today's bound had. A
  // billing section that reads the kept billing page sends no request, so two intervals can lie between two requests (D23).
  assert.ok(longestGap(harness.rsi.requests.filter((request) => request.at >= resumedAt)) <= 2 * 2500, "pacing is back to normal after the restart");
  const snapshot = await harness.repository.getSnapshot("SyntheticCitizen");
  await assertCompleteDocument(snapshot.document, harness.rsi);
  assert.deepEqual([...harness.alarms.keys()], []);
});

test("the owning dashboard's status poll restarts a stopped loop without waiting for the alarm", async () => {
  const { harness, tab } = await runningBuild({ account: { counts: { pledges: 120 } } }, 9);
  const alarm = { ...harness.alarms.get(WATCHDOG_ALARM) };
  harness.stopWorker();
  const requestsAtStop = harness.rsi.requests.length;
  const status = await tab.status();
  assert.equal(status.status, "running");
  assert.equal(status.requiresRebind, false);
  await harness.advance(() => harness.rsi.requests.length > requestsAtStop);
  assert.ok(harness.clock.now < alarm.scheduledTime, "collection resumed before the alarm was due");
  assert.equal((await harness.finishJob()).status, "complete");
  await assertCompleteDocument(resultOf(tab), harness.rsi);
});

test("a watchdog alarm with nothing to supervise clears itself and starts nothing", async () => {
  const { harness, tab } = await runningBuild({}, 6);
  assert.equal((await tab.request("PAUSE")).ok, true);
  assert.deepEqual([...harness.alarms.keys()], [], "pausing clears the watchdog");
  const requestsAtPause = harness.rsi.requests.length;
  // A stale alarm, as could be left by a worker that was stopped between two writes.
  harness.stopWorker();
  await harness.deliver({ kind: "UNRELATED" }, {});
  harness.alarms.clear();
  await harness.popup.request("GET_STATUS");
  const worker = harness.workerStarts;
  await harness.advanceBy(120000);
  assert.equal(harness.rsi.requests.length, requestsAtPause, "a paused job stays paused");
  assert.equal(harness.state().status, "paused");
  assert.equal(harness.workerStarts, worker);
});

test("closing and reopening the browser pauses a running job instead of resuming it unattended", async () => {
  const { harness, tab } = await runningBuild({}, 6);
  const requests = harness.rsi.requests.length;
  await harness.restartBrowser();
  assert.equal(harness.state().status, "paused");
  assert.deepEqual([...harness.alarms.keys()], []);
  await harness.advanceBy(90000);
  assert.equal(harness.rsi.requests.length, requests);
  // The dashboard that started it can resume it.
  const resumed = await tab.request("RESUME");
  assert.equal(resumed.ok, true);
  assert.equal((await harness.finishJob()).status, "complete");
  await assertCompleteDocument((await harness.repository.getSnapshot("SyntheticCitizen")).document, harness.rsi);
});

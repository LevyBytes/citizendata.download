import assert from "node:assert/strict";
import test from "node:test";
import { WATCHDOG_ALARM } from "../support/extension-harness.mjs";
import { assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { LOCAL_DASHBOARD_URL } from "./service-worker-fixture-local-dashboard-address.mjs";
import { resultOf, runningBuild } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("pause, resume, and cancel from the owning dashboard take effect at once and are final", async () => {
  const { harness, tab } = await runningBuild({ account: { latencyMs: 300 } }, 7);
  const paused = await tab.request("PAUSE");
  assert.equal(paused.ok, true);
  assert.equal(paused.status.status, "paused");
  await harness.advanceBy(5000);
  const atPause = harness.rsi.requests.length;
  await harness.advanceBy(60000);
  assert.equal(harness.rsi.requests.length, atPause, "a paused job requests nothing");
  assert.equal(harness.state().status, "paused", "a step that was in flight did not undo the pause");

  assert.equal((await tab.request("RESUME")).status.status, "running");
  assert.deepEqual([...harness.alarms.keys()], [WATCHDOG_ALARM]);
  await harness.advance(() => harness.rsi.requests.length >= atPause + 4);

  const cancelled = await tab.request("CANCEL");
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.status.status, "cancelled");
  await harness.advanceBy(5000);
  const atCancel = harness.rsi.requests.length;
  await harness.advanceBy(120000);
  assert.equal(harness.rsi.requests.length, atCancel, "a cancelled job requests nothing");
  assert.equal(harness.state().status, "cancelled");
  assert.equal(harness.state().activeJobId, null);
  assert.deepEqual([...harness.alarms.keys()], []);
  assert.equal(resultOf(tab), null);
  assert.ok(!await harness.repository.getSnapshot("SyntheticCitizen"), "a cancelled run saves no backup");
  assert.equal((await tab.request("RESUME")).code, "NO_ACTIVE_JOB");
  // The cancelled run's one-run authorization cannot be used again.
  const [job] = await harness.repository.listJobs();
  assert.ok((await harness.repository.getAuthorization(job.authorizationId)).revokedAt);
  assert.equal((await tab.build()).code, "RUN_STARTED", "a new build can start after a cancel");
});

test("another dashboard session cannot control a run; taking it over is explicit and stays within one origin", async () => {
  const { harness, tab } = await runningBuild({ account: { counts: { pledges: 120 } } }, 7);
  const second = harness.openTab();
  // A second tab, or the same tab reloaded, is a new session. Its status requests, and a third tab's, change nothing:
  // the run keeps running for the session that controls it, which is still the first.
  const requestsBefore = harness.rsi.requests.length;
  const seen = await second.status();
  assert.deepEqual([seen.status, seen.controlSessionBound, seen.requiresRebind], ["running", false, true]);
  for (const type of ["RESUME", "CANCEL", "PAUSE"]) assert.equal((await second.request(type)).code, "JOB_BINDING_MISMATCH", type);
  for (const other of [second, harness.openTab(), second]) assert.equal((await other.status()).status, "running");
  // While the owner has it paused, other sessions' status requests ask nothing of RSI and leave it paused.
  assert.equal((await tab.request("PAUSE")).ok, true);
  const atPause = harness.rsi.requests.length;
  for (const other of [second, harness.openTab(), second]) assert.equal((await other.status()).status, "paused");
  assert.deepEqual([harness.rsi.requests.length, (await tab.request("RESUME")).ok], [atPause, true]);
  assert.equal((await tab.status()).controlSessionBound, true);
  await harness.advance(() => harness.rsi.requests.length > requestsBefore + 2);
  assert.equal(harness.state().status, "running");

  // A local copy is another origin and cannot take the run at all.
  const local = harness.openTab(LOCAL_DASHBOARD_URL);
  assert.equal((await harness.approveLocalDashboard(local)).ok, true);
  assert.equal((await local.request("REQUEST_REBIND")).code, "REBIND_ORIGIN_MISMATCH");

  const rebound = await second.request("REQUEST_REBIND");
  assert.equal(rebound.code, "RUN_RECONNECTED");
  assert.equal(rebound.resumed, true);
  assert.equal(rebound.status.controlSessionBound, true);
  assert.equal((await second.request("REQUEST_REBIND")).code, "ALREADY_BOUND");
  // The first session lost control when the second took it.
  assert.equal((await tab.request("CANCEL")).code, "JOB_BINDING_MISMATCH");
  // Its status request is told so, and changes nothing, as any other session's.
  assert.deepEqual([(await tab.status()).requiresRebind, harness.state().status], [true, "running"]);

  assert.equal((await harness.finishJob()).status, "complete");
  await assertCompleteDocument(resultOf(second), harness.rsi);
  assert.equal(resultOf(tab), null, "the result goes to the session that owns the run");
});

test("two sessions that reconnect at once leave one in control, and a restarted worker keeps that binding", async () => {
  const { harness } = await runningBuild({ account: { counts: { pledges: 120 } } }, 7);
  const [left, right] = [harness.openTab(), harness.openTab()];
  const answers = await Promise.all([left.request("REQUEST_REBIND"), right.request("REQUEST_REBIND")]);
  assert.deepEqual(answers.map((answer) => answer.ok), [true, true]);
  const bound = async () => [(await left.status()).controlSessionBound, (await right.status()).controlSessionBound];
  const owners = await bound();
  assert.equal(owners.filter(Boolean).length, 1, JSON.stringify(owners));
  assert.equal(harness.state().status, "running");
  harness.stopWorker();
  assert.deepEqual(await bound(), owners);
  const owner = owners[0] ? left : right;
  assert.equal((await harness.finishJob()).status, "complete");
  await assertCompleteDocument(resultOf(owner), harness.rsi);
});

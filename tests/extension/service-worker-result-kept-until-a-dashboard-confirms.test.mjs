import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { LOCAL_DASHBOARD_URL } from "./service-worker-fixture-local-dashboard-address.mjs";
import { resultOf, runningBuild } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a run that finishes with no dashboard open keeps its result until a dashboard of the same origin saves it", async () => {
  const { harness, tab } = await runningBuild({}, 6);
  tab.close();
  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete");
  assert.equal(finished.pendingResult.runId, finished.lastCompletedRunId);
  assert.equal(finished.pendingResult.jobKind, "accountData");
  assert.equal(finished.pendingResult.dashboardOrigin, "https://citizendata.download");

  // A local copy is a different origin: it is not told about the result and cannot fetch or dismiss it.
  const local = harness.openTab(LOCAL_DASHBOARD_URL);
  await harness.approveLocalDashboard(local);
  assert.equal((await local.status()).completedResultPending, null);
  assert.equal((await local.request("GET_COMPLETED_RESULT")).code, "NO_COMPLETED_RESULT");
  assert.equal((await local.request("ACKNOWLEDGE_RESULT", { runId: finished.pendingResult.runId })).code, "NO_COMPLETED_RESULT");
  // The popup's status carries no result either.
  assert.equal((await harness.popup.request("GET_STATUS")).status.completedResultPending, null);

  const reopened = harness.openTab();
  const status = await reopened.status();
  assert.deepEqual(status.completedResultPending, { runId: finished.pendingResult.runId, jobKind: "accountData", status: "complete" });
  const fetched = await reopened.request("GET_COMPLETED_RESULT");
  assert.equal(fetched.ok, true);
  assert.equal(fetched.runId, finished.pendingResult.runId);
  assert.equal(fetched.jobKind, "accountData");
  assert.equal(fetched.selectedSections.length, 15);
  await assertCompleteDocument(fetched.result, harness.rsi);
  // Fetching does not consume it: a dashboard that failed to save can ask again.
  assert.equal((await reopened.request("GET_COMPLETED_RESULT")).ok, true);
  assert.equal((await reopened.request("ACKNOWLEDGE_RESULT", { runId: "33333333-3333-4333-8333-333333333333" })).code, "NO_COMPLETED_RESULT");
  assert.equal(harness.state().pendingResult.runId, finished.pendingResult.runId);

  const acknowledged = await reopened.request("ACKNOWLEDGE_RESULT", { runId: finished.pendingResult.runId });
  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.status.completedResultPending, null);
  assert.equal(harness.state().pendingResult, null);
  assert.equal((await reopened.request("GET_COMPLETED_RESULT")).code, "NO_COMPLETED_RESULT");
  // The saved backup itself stays in the extension for the next update.
  assert.ok(await harness.repository.getSnapshot("SyntheticCitizen"));
});

test("a result delivered to an open dashboard still waits for that dashboard's confirmation", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  await tab.build();
  const finished = await harness.finishJob();
  assert.ok(resultOf(tab));
  assert.equal(finished.pendingResult.runId, finished.lastCompletedRunId, "delivery alone does not prove the file was saved");
  assert.equal((await tab.request("ACKNOWLEDGE_RESULT", { runId: finished.lastCompletedRunId })).ok, true);
  assert.equal(harness.state().pendingResult, null);
  // A later run replaces an unconfirmed result with its own.
  tab.reload();
  await tab.build();
  const second = await harness.finishJob();
  assert.equal(second.pendingResult.runId, second.lastCompletedRunId);
  assert.notEqual(second.lastCompletedRunId, finished.lastCompletedRunId);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { AccountDocument, assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { LOCAL_DASHBOARD_URL } from "./service-worker-fixture-local-dashboard-address.mjs";
import { resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a failed run offers what it collected and continues from where it stopped", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  // RSI fails once, on the second page of buybacks.
  // A 401 signs the session out and stops the run; a 410 would set the section aside (§10.1), and a passing 500 or 503 would be retried (§6.4 rule 8, §7.4).
  harness.rsi.failNext((request) => request.path === "/api/account/buybackPledges" && request.page === 2, { status: 401 });
  await tab.build();
  const failed = await harness.finishJob();
  assert.equal(failed.status, "failed");
  assert.equal(failed.activeJobId, null);
  assert.deepEqual([...harness.alarms.keys()], []);
  const failure = tab.lastEvent();
  assert.equal(failure.event, "failed");
  assert.equal(failure.status.activeJob.failure.code, "RSI_SIGNED_OUT");
  assert.equal(failure.status.activeJob.failure.message, "The RSI session is signed out.");
  assert.equal(failure.status.activeJob.currentSection, "buybacks");
  assert.equal(failure.status.partialAvailable, true);
  assert.equal(failure.status.continuable, true);
  assert.equal(resultOf(tab), null, "a failed run delivers no finished result");

  // The partial backup holds every finished section and says which are not finished.
  const partial = (await tab.request("GET_PARTIAL_RESULT")).partialResult;
  assert.deepEqual(JSON.parse(JSON.stringify(failure.partialResult.pledges)), partial.pledges);
  assert.equal(partial.pledges.length, harness.rsi.state.pledges.length);
  assert.equal(partial.hangarLog.length, harness.rsi.state.hangarLog.length);
  assert.equal(partial.sync.sectionOutcomes.pledges.status, "complete");
  assert.notEqual(partial.sync.sectionOutcomes.buybacks?.status, "complete");
  assert.equal(await AccountDocument.verifyIntegrity(structuredClone(partial)), true);
  AccountDocument.assertValid(structuredClone(partial), globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
  assert.ok(!await harness.repository.getSnapshot("SyntheticCitizen"), "a failed run is not promoted to the saved backup");

  // The popup lists it as an incomplete run.
  const incomplete = await harness.popup.request("LIST_INCOMPLETE_RUNS");
  assert.deepEqual(incomplete.runs.map((run) => [run.status, run.failure.code]), [["failed", "RSI_SIGNED_OUT"]]);

  // Another origin can neither read nor continue it.
  const local = harness.openTab(LOCAL_DASHBOARD_URL);
  await harness.approveLocalDashboard(local);
  assert.equal((await local.request("GET_PARTIAL_RESULT")).code, "PARTIAL_ORIGIN_MISMATCH");
  assert.equal((await local.request("CONTINUE_PARTIAL")).code, "PARTIAL_ORIGIN_MISMATCH");

  const before = harness.rsi.requests.length;
  const continued = await tab.request("CONTINUE_PARTIAL");
  assert.equal(continued.code, "RUN_STARTED", continued.message);
  assert.equal(continued.status.activeJob.mode, "continuation");
  assert.equal(continued.status.activeJob.sectionCount, 15, "progress still counts every section of the original plan");
  assert.equal((await harness.finishJob()).status, "complete");
  const paths = harness.rsi.requests.slice(before).map((request) => `${request.path}${request.page ? `#${request.page}` : ""}`);
  assert.ok(paths.includes("/api/account/buybackPledges#2") && paths.includes("/api/account/buybackPledges#3"));
  assert.ok(!paths.includes("/api/account/buybackPledges#1"), "the page collected before the failure is not requested again");
  assert.ok(!paths.some((entry) => entry.startsWith("/account/pledges") || entry.startsWith("/api/account/pledgeLog") || entry.startsWith("/account/billing")), "finished sections are not collected again");
  const document = resultOf(tab);
  await assertCompleteDocument(document, harness.rsi);
  assert.deepEqual(document.sync.runs.map((run) => run.status), ["failed", "complete"], "both runs are on record");
  // The failed run was superseded: it can be neither opened nor continued a second time.
  assert.equal((await tab.request("GET_PARTIAL_RESULT")).code, "NO_PARTIAL_RESULT");
  assert.equal((await tab.request("CONTINUE_PARTIAL")).code, "NO_PARTIAL_RESULT");
  assert.deepEqual(harness.consoleCalls, [], "a failure is reported to the dashboard, not logged");
});

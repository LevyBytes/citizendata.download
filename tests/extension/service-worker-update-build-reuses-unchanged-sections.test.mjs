import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { kept, pagedThrough, resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a second build updates the saved backup, reusing what RSI shows unchanged and reading the hangar and buy-back lists only after a new Hangar Log entry", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  await tab.build();
  await harness.finishJob();
  const first = resultOf(tab);
  const firstRequests = harness.rsi.requests.length;

  tab.reload();
  const unchanged = await tab.build();
  assert.equal(unchanged.status.activeJob.mode, "update");
  await harness.finishJob();
  const second = resultOf(tab);
  await assertCompleteDocument(second, harness.rsi);
  // The Hangar Log holds nothing new, so the hangar and the buy-back list are not asked for at all. Every other list
  // is checked with its newest page only, and no buy-back page is read again.
  const secondRequests = harness.rsi.requests.slice(firstRequests);
  assert.ok(secondRequests.length < firstRequests, `an unchanged account needed ${secondRequests.length} requests after ${firstRequests}`);
  assert.deepEqual(pagedThrough(secondRequests), []);
  assert.deepEqual(secondRequests.filter((request) => ["/account/pledges", "/api/account/buybackPledges"].includes(request.path)), []);
  assert.deepEqual(secondRequests.filter((request) => request.path.startsWith("/pledge/buyback/")), []);
  // Neither list was read, so neither was compared with the first backup.
  const notRead = { status: "not-compared", reason: "list-not-read", missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept: 0 };
  assert.deepEqual([second.sync.removalTracking.pledges, second.sync.removalTracking.buybacks, second.sync.removalTracking.comparedWithExportedAt], [notRead, notRead, first.exportedAt]);
  assert.deepEqual([first.sync.removalTracking.pledges.status, first.sync.removalTracking.pledges.reason, first.sync.removalTracking.comparedWithExportedAt], ["not-compared", "no-earlier-backup", null]);
  assert.equal(second.account.localAccountId, first.account.localAccountId, "the account keeps its local identifier");
  assert.deepEqual(second.sync.runs.map((run) => run.runId), [first.sync.runs[0].runId, second.sync.runs[1].runId], "runs are appended, not replaced");
  assert.deepEqual(second.pledges.map((record) => record.pledgeId), first.pledges.map((record) => record.pledgeId));

  // Three new pledges show up in the Hangar Log and in the hangar. The new log entries have both lists read in full,
  // and both are compared with the second backup.
  harness.rsi.addPledges(3);
  const secondEnd = harness.rsi.requests.length;
  tab.reload();
  await tab.build();
  await harness.finishJob();
  const third = resultOf(tab);
  await assertCompleteDocument(third, harness.rsi);
  assert.equal(third.pledges.length, first.pledges.length + 3);
  assert.equal(third.sync.runs.length, 3);
  const thirdRequests = harness.rsi.requests.slice(secondEnd);
  assert.equal(thirdRequests.filter((request) => request.path === "/account/pledges").length, Math.ceil(harness.rsi.state.pledges.length / 10));
  assert.equal(thirdRequests.filter((request) => request.path === "/api/account/buybackPledges").length, Math.ceil(harness.rsi.state.buybacks.length / 100));
  const compared = { status: "compared", reason: null, missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept: 0 };
  assert.deepEqual([third.sync.removalTracking.pledges, third.sync.removalTracking.buybacks, third.sync.removalTracking.comparedWithExportedAt], [compared, compared, second.exportedAt]);
});

test("an unchanged Hangar Log recognized only on a later step reuses the saved log without a count error", async () => {
  // The log is the only section here that searches for its saved rows across steps.
  // At ten rows a page the first step cannot hold the twenty newest saved rows, so the match is found on the second.
  const harness = await createExtensionHarness({ account: { hangarLogRowsPerPage: 10 } });
  const tab = harness.openTab();
  await tab.build();
  assert.equal((await harness.finishJob()).status, "complete");
  const first = resultOf(tab);
  tab.reload();
  const before = harness.rsi.requests.length;
  await tab.build();
  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete", JSON.stringify((await tab.status()).activeJob.failure));
  const second = resultOf(tab);
  await assertCompleteDocument(second, harness.rsi);
  assert.deepEqual(harness.rsi.requests.slice(before).filter((request) => request.path === "/api/account/pledgeLog").map((request) => request.page), [1, 2, 3]);
  assert.deepEqual(JSON.parse(JSON.stringify(second.hangarLog)), JSON.parse(JSON.stringify(first.hangarLog)));
  // The log holds nothing new, so neither list was read again.
  assert.deepEqual([second.sync.removalTracking.pledges.reason, second.sync.removalTracking.buybacks.reason], ["list-not-read", "list-not-read"]);
  assert.deepEqual(kept(harness).pages, []);
});

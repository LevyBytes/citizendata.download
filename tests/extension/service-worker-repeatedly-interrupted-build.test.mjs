import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { kept, resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a build interrupted again and again by Chrome records what an uninterrupted build records", async () => {
  const account = { counts: { pledges: 64, buybacks: 420, olderHangarLogRows: 130, prospects: 320 } };
  const record = (document) => ({
    pledges: document.pledges.map((entry) => [entry.pledgeId, entry.title, entry.sourcePage, entry.items.length]),
    buybacks: document.buybacks.map((entry) => [entry.buybackId, entry.title, entry.sourcePage]),
    hangarLog: document.hangarLog.map((entry) => [entry.recordKey, entry.rawTimestamp, entry.subjectId, entry.kind]),
    orders: document.financial.orders.map((entry) => entry.orderId),
    ledgers: Object.values(document.financial.creditLedgers).map((rows) => rows.map((entry) => [entry.recordKey, entry.rawTimestamp, entry.amount])),
    referrals: [document.referrals.current.prospects, document.referrals.legacy.prospects, document.referrals.current.recruits, document.referrals.legacy.recruits].map((rows) => rows.map((entry) => entry.recordKey)),
    outcomes: Object.fromEntries(Object.entries(document.sync.sectionOutcomes).map(([section, outcome]) => [section, [outcome.status, outcome.records, outcome.pagesOrBatches, outcome.warnings, outcome.sourceUrls]])),
    anomalies: document.dataQuality.anomalies.length
  });

  const steady = await createExtensionHarness({ account });
  const steadyTab = steady.openTab();
  await steadyTab.build();
  await steady.finishJob();
  const expected = record(JSON.parse(JSON.stringify(resultOf(steadyTab))));

  const harness = await createExtensionHarness({ account });
  const tab = harness.openTab();
  await tab.build();
  // The worker is stopped after every third request; the dashboard's status poll brings it back.
  let stops = 0;
  for (;;) {
    const target = harness.rsi.requests.length + 3;
    await harness.advance(() => harness.rsi.requests.length >= target || harness.state().status !== "running");
    if (harness.state().status !== "running") break;
    harness.stopWorker();
    stops += 1;
    await tab.status();
  }
  assert.ok(stops >= 10, `the worker was stopped ${stops} times`);
  assert.equal(harness.state().status, "complete");
  await assertCompleteDocument(resultOf(tab), harness.rsi);
  assert.deepEqual(record(JSON.parse(JSON.stringify(resultOf(tab)))), expected);
  // A restarted worker continued from the stored pages. Only a step that was in flight when the worker stopped was
  // taken again, so no request was repeated more than once.
  const requested = (rsi) => {
    const counts = new Map();
    for (const request of rsi.requests) {
      const key = `${request.method} ${request.path} ${request.page ?? ""}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const [interrupted, uninterrupted] = [requested(harness.rsi), requested(steady.rsi)];
  assert.deepEqual([...interrupted.keys()].sort(), [...uninterrupted.keys()].sort());
  const repeated = [...interrupted].map(([key, count]) => [key, count - uninterrupted.get(key)]).filter(([, extra]) => extra !== 0);
  assert.ok(repeated.every(([, extra]) => extra === 1), JSON.stringify(repeated));
  assert.ok(repeated.length > 0 && repeated.length <= stops * 3, `${repeated.length} requests were repeated over ${stops} stops`);
  assert.deepEqual(kept(harness).pages, []);
});

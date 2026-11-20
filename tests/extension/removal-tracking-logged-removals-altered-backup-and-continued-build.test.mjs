import assert from "node:assert/strict";
import test from "node:test";
import { account, assertValid, build, counts, plain, resultOf } from "./removal-tracking-loaded-with-fixture-build.mjs";

test("a removal RSI logged itself is accounted for by the log, so the record leaves its list", async () => {
  const { harness, tab, buyback, pledge } = await account();
  harness.rsi.removeWithLogNotice("buybacks", buyback.id);
  harness.rsi.removeWithLogNotice("pledges", pledge.id, "Automated 0$ CCU removal");
  const second = await build(harness, tab);
  assert.ok(!second.buybacks.some((record) => record.buybackId === buyback.id) && !second.pledges.some((record) => record.pledgeId === pledge.id));
  assert.ok([...second.pledges, ...second.buybacks].every((record) => !record.removal && record.state !== "not-reconcilable"));
  // The backup's own Hangar Log holds RSI's line for each.
  assert.ok(second.hangarLog.some((entry) => entry.subjectId === buyback.id && entry.rawDetail === "automated removal of 0$ CCUs"));
  assert.ok(second.hangarLog.some((entry) => entry.subjectId === pledge.id && entry.rawDetail === "Automated 0$ CCU removal"));
  assert.deepEqual([second.sync.removalTracking.buybacks, second.sync.removalTracking.pledges], [counts({ missing: 1, explained: 1 }), counts({ missing: 1, explained: 1 })]);
});

test("a pledge the owner melted and a buy-back the owner bought back leave their lists as before, with the log holding the event", async () => {
  const { harness, tab, buyback, pledge } = await account();
  harness.rsi.meltPledge(pledge.id);
  harness.rsi.buyBack(buyback.id);
  const second = await build(harness, tab);
  assert.ok(!second.pledges.some((record) => record.pledgeId === pledge.id), "the melted pledge is not in the hangar");
  assert.ok(second.buybacks.some((record) => record.buybackId === pledge.id && record.state === "available"), "it is in the buy-back list under the same number");
  assert.ok(!second.buybacks.some((record) => record.buybackId === buyback.id), "the bought-back pledge is not in the buy-back list");
  assert.ok(second.pledges.every((record) => record.state === "current") && second.buybacks.every((record) => record.state === "available"));
  assert.deepEqual([second.sync.removalTracking.pledges, second.sync.removalTracking.buybacks], [counts({ missing: 1, explained: 1 }), counts({ missing: 1, explained: 1 })]);
  assert.deepEqual(second.hangarLog.slice(0, 2).map((entry) => [entry.subjectId, entry.kind]), [[buyback.id, "buyback"], [pledge.id, "reclaimed"]]);
});

test("no removal is claimed against a saved backup that was altered, and the backup says why", async () => {
  const { harness, tab, buyback, pledge } = await account();
  // The saved backup is changed where the extension keeps it, without its hash being renewed.
  const [saved] = [...harness.repository.inspect().snapshots.values()];
  saved.document.pledges[0].title = `${saved.document.pledges[0].title} (edited)`;
  harness.rsi.removeSilently("buybacks", buyback.id);
  harness.rsi.removeSilently("pledges", pledge.id);
  // Another logged event, so both lists are read.
  harness.rsi.addPledges(1);
  const second = await build(harness, tab);
  const notCompared = { status: "not-compared", reason: "earlier-backup-not-verified", missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept: 0 };
  assert.deepEqual([second.sync.removalTracking.pledges, second.sync.removalTracking.buybacks], [notCompared, notCompared]);
  assert.ok(!second.buybacks.some((record) => record.buybackId === buyback.id) && !second.pledges.some((record) => record.pledgeId === pledge.id));
  assert.ok([...second.pledges, ...second.buybacks].every((record) => !record.removal));
});

test("a build that fails after reading both lists and is continued makes the same claims", async () => {
  const { harness, tab, buyback } = await account();
  harness.rsi.removeSilently("buybacks", buyback.id);
  // The Hangar Log has one new entry, so both lists are read; then RSI fails on the first referral request.
  harness.rsi.addPledges(1);
  const start = harness.rsi.requests.length;
  harness.rsi.failNext((request) => request.path === "/graphql" && harness.rsi.requests.slice(start).some((earlier) => earlier.path === "/api/account/buybackPledges"), { status: 503 });
  tab.reload();
  await tab.build();
  assert.equal((await harness.finishJob()).status, "failed");
  const partial = plain((await tab.request("GET_PARTIAL_RESULT")).partialResult);
  await assertValid(partial);
  assert.deepEqual([partial.buybacks.at(-1).buybackId, partial.buybacks.at(-1).state], [buyback.id, "not-reconcilable"], "the partial backup already holds the claim");

  const continued = await tab.request("CONTINUE_PARTIAL");
  assert.equal(continued.code, "RUN_STARTED", continued.message);
  assert.equal((await harness.finishJob()).status, "complete");
  const document = resultOf(tab);
  await assertValid(document);
  // The continued run did not read the Hangar Log again; the first part had read it.
  assert.deepEqual(harness.rsi.requests.slice(start).filter((request) => request.path === "/api/account/pledgeLog").length, 1);
  assert.deepEqual(document.sync.removalTracking.buybacks, counts({ missing: 1, notReconcilable: 1, kept: 1 }));
  assert.deepEqual([document.buybacks.at(-1).buybackId, document.buybacks.at(-1).state], [buyback.id, "not-reconcilable"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { account, build, counts, listRequests, notRead } from "./removal-tracking-loaded-with-fixture-build.mjs";

test("a pledge and a buy-back RSI stops listing without a Hangar Log entry are kept as not reconcilable when the lists are next read, and return with their history", async () => {
  const { harness, tab, first, buyback, pledge } = await account();
  const removedBuyback = harness.rsi.removeSilently("buybacks", buyback.id);
  const removedPledge = harness.rsi.removeSilently("pledges", pledge.id);

  // The Hangar Log holds nothing new, so neither list is asked for and both stay as the first backup has them.
  let before = harness.rsi.requests.length;
  const unread = await build(harness, tab);
  assert.deepEqual(listRequests(harness.rsi.requests.slice(before)), []);
  assert.deepEqual([unread.pledges.map((record) => record.pledgeId), unread.buybacks.map((record) => record.buybackId)], [first.pledges.map((record) => record.pledgeId), first.buybacks.map((record) => record.buybackId)]);
  assert.deepEqual([unread.sync.removalTracking.pledges, unread.sync.removalTracking.buybacks], [notRead(), notRead()]);

  // The account's next logged event has both lists read again, and the two records are found missing.
  harness.rsi.addPledges(1);
  before = harness.rsi.requests.length;
  const second = await build(harness, tab);

  // Each is still in the backup, after the records RSI lists, as it was last seen.
  for (const [list, key, id, listedState] of [["buybacks", "buybackId", buyback.id, "available"], ["pledges", "pledgeId", pledge.id, "current"]]) {
    const earlier = unread[list].find((record) => record[key] === id);
    const kept = second[list].at(-1);
    assert.deepEqual(kept, { ...earlier, state: "not-reconcilable", removal: { lastSeenAt: earlier.observation.lastObservedAt, firstMissingAt: second.exportedAt, returnedAt: null } }, list);
    assert.deepEqual(second[list].slice(0, -1).map((record) => record[key]), harness.rsi.state[list].map((record) => record.id), `${list}: the listed records come first, in RSI's order`);
    assert.ok(second[list].slice(0, -1).every((record) => record.state === listedState && !record.removal));
    assert.deepEqual(second.sync.removalTracking[list], counts({ missing: 1, notReconcilable: 1, kept: 1 }));
  }
  assert.equal(second.sync.removalTracking.comparedWithExportedAt, unread.exportedAt);
  // The buy-back keeps the price and the detail captured from its own page, and that page is not asked for again.
  assert.deepEqual(second.buybacks.at(-1).buybackPrice, first.buybacks.find((record) => record.buybackId === buyback.id).buybackPrice);
  assert.deepEqual(second.buybackDetails.find((detail) => detail.buybackId === buyback.id), first.buybackDetails.find((detail) => detail.buybackId === buyback.id));
  assert.deepEqual(harness.rsi.requests.slice(before).filter((request) => request.path.startsWith("/pledge/buyback/")), []);
  // The section outcomes count what RSI listed; the comparison counts what was kept beside it.
  assert.deepEqual([second.sync.sectionOutcomes.buybacks.records, second.buybacks.length], [harness.rsi.state.buybacks.length, harness.rsi.state.buybacks.length + 1]);

  // The next backup carries both forward unchanged and claims nothing new: first with the lists not read, then with
  // the lists read again after another logged event.
  const third = await build(harness, tab);
  assert.deepEqual([third.buybacks.at(-1), third.pledges.at(-1)], [second.buybacks.at(-1), second.pledges.at(-1)]);
  assert.deepEqual([third.sync.removalTracking.buybacks, third.sync.removalTracking.pledges], [notRead(1), notRead(1)]);
  harness.rsi.addPledges(1);
  const reread = await build(harness, tab);
  assert.deepEqual([reread.buybacks.at(-1), reread.pledges.at(-1)], [second.buybacks.at(-1), second.pledges.at(-1)]);
  assert.deepEqual([reread.sync.removalTracking.buybacks, reread.sync.removalTracking.pledges], [counts({ kept: 1 }), counts({ kept: 1 })]);

  // RSI lists them again, and the lists are read after the next logged event. Each goes back to its normal state where
  // RSI lists it, and keeps its history.
  harness.rsi.restore("buybacks", removedBuyback);
  harness.rsi.restore("pledges", removedPledge);
  harness.rsi.addPledges(1);
  const fourth = await build(harness, tab);
  for (const [list, key, id, listedState] of [["buybacks", "buybackId", buyback.id, "available"], ["pledges", "pledgeId", pledge.id, "current"]]) {
    assert.deepEqual(fourth[list].map((record) => record[key]), harness.rsi.state[list].map((record) => record.id));
    const returned = fourth[list].find((record) => record[key] === id);
    assert.deepEqual([returned.state, returned.removal], [listedState, { ...second[list].at(-1).removal, returnedAt: fourth.exportedAt }]);
    assert.deepEqual(fourth.sync.removalTracking[list], counts({ returned: 1 }));
  }
  const fifth = await build(harness, tab);
  assert.deepEqual(fifth.buybacks.find((record) => record.buybackId === buyback.id).removal, fourth.buybacks.find((record) => record.buybackId === buyback.id).removal, "the history stays, and the return date does not move");
  assert.deepEqual(fifth.sync.removalTracking.buybacks, notRead());
});

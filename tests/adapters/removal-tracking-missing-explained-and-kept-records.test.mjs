import assert from "node:assert/strict";
import test from "node:test";
import { EARLIER, NOW, OLD_LOG, buyback, compare, counts, earlier, logRow, pledge } from "./removal-tracking-loaded-with-fixture-backups.mjs";

test("nothing missing: both lists are compared and nothing is kept", () => {
  const { document, tracking } = compare();
  assert.deepEqual(tracking, { comparedAt: NOW, comparedWithExportedAt: EARLIER, pledges: counts(), buybacks: counts() });
  assert.deepEqual([document.pledges.length, document.buybacks.length], [3, 3]);
});

test("a record that is gone with no new log entry naming it is kept as not reconcilable", () => {
  const { document, tracking } = compare({ pledges: [pledge(1), pledge(3)], buybacks: [buyback(11), buyback(13)], newRows: [logRow(30, 777)] });
  assert.deepEqual(tracking.pledges, counts({ missing: 1, notReconcilable: 1, kept: 1 }));
  assert.deepEqual(tracking.buybacks, counts({ missing: 1, notReconcilable: 1, kept: 1 }));
  // Kept after the listed records, as it was last seen, with when it was last seen and first found missing.
  assert.deepEqual(document.pledges.map((record) => [record.pledgeId, record.state]), [[1, "current"], [3, "current"], [2, "not-reconcilable"]]);
  assert.deepEqual(document.pledges[2], { ...pledge(2), state: "not-reconcilable", removal: { lastSeenAt: EARLIER, firstMissingAt: NOW, returnedAt: null } });
  assert.deepEqual(document.buybacks[2], { ...buyback(12), state: "not-reconcilable", removal: { lastSeenAt: EARLIER, firstMissingAt: NOW, returnedAt: null } });
});

test("a new log entry naming the record accounts for it, RSI's own removal notice included", () => {
  const { document, tracking } = compare({
    pledges: [pledge(3)],
    buybacks: [buyback(13)],
    newRows: [
      logRow(31, 1, "Reclaimed by Citizen for $10.00 USD"),
      logRow(32, 2, "automated removal of 0$ CCUs"),
      logRow(33, 11, "Buy-back by Citizen - order #A1"),
      logRow(34, 12, "Automated 0$ CCU removal after the upgrade was applied")
    ]
  });
  assert.deepEqual(tracking.pledges, counts({ missing: 2, explained: 2 }));
  assert.deepEqual(tracking.buybacks, counts({ missing: 2, explained: 2 }));
  // Each leaves its list as it always did; the log holds the entry that names it.
  assert.deepEqual(document.pledges.map((record) => [record.pledgeId, record.state]), [[3, "current"]]);
  assert.deepEqual(document.buybacks.map((record) => [record.buybackId, record.state]), [[13, "available"]]);
  assert.ok([...document.pledges, ...document.buybacks].every((record) => !record.removal));
});

test("only entries newer than the earlier backup's log count, however an older entry is worded", () => {
  // The earlier log already names pledge 2. That is history, not an account of why it is gone now.
  const previous = earlier({ hangarLog: [logRow(26, 2, "automated removal of 0$ CCUs"), ...OLD_LOG] });
  const { document, tracking } = compare({ previous, pledges: [pledge(1), pledge(3)] });
  assert.deepEqual(tracking.pledges, counts({ missing: 1, notReconcilable: 1, kept: 1 }));
  assert.equal(document.pledges[2].state, "not-reconcilable");
});

test("a kept record is carried forward, leaves when a later log entry names it, and returns with its history", () => {
  const removal = { lastSeenAt: EARLIER, firstMissingAt: "2026-11-05T12:00:00.000Z", returnedAt: null };
  const previous = earlier({ pledges: [pledge(1), pledge(2, { state: "not-reconcilable", removal })], buybacks: [buyback(11), buyback(12, { state: "not-reconcilable", removal }), buyback(13, { state: "not-reconcilable", removal })] });
  // Still missing: carried forward unchanged and not counted as newly missing.
  const carried = compare({ previous, pledges: [pledge(1)], buybacks: [buyback(11)] });
  assert.deepEqual(carried.tracking.pledges, counts({ kept: 1 }));
  assert.deepEqual(carried.tracking.buybacks, counts({ kept: 2 }));
  assert.deepEqual(carried.document.pledges[1], previous.pledges[1]);
  assert.deepEqual(carried.document.buybacks.slice(1), previous.buybacks.slice(1));

  // A log entry written afterwards names the pledge: the log now accounts for it, so it is no longer kept. The
  // buy-backs no entry names stay.
  const noticed = compare({ previous, pledges: [pledge(1)], buybacks: [buyback(11)], newRows: [logRow(35, 2, "automated removal of 0$ CCUs")] });
  assert.deepEqual(noticed.document.pledges.map((record) => record.pledgeId), [1]);
  assert.deepEqual(noticed.tracking.pledges, counts({ explained: 1 }));
  assert.deepEqual(noticed.tracking.buybacks, counts({ kept: 2 }));

  // RSI lists them again: normal state from the new list, with the history and when it returned.
  const returned = compare({ previous, pledges: [pledge(1), pledge(2)], buybacks: [buyback(11), buyback(12), buyback(13)] });
  assert.deepEqual(returned.tracking.pledges, counts({ returned: 1 }));
  assert.deepEqual(returned.tracking.buybacks, counts({ returned: 2 }));
  assert.deepEqual(returned.document.pledges[1], { ...pledge(2), removal: { ...removal, returnedAt: NOW } });
  assert.deepEqual(returned.document.buybacks[2].removal, { ...removal, returnedAt: NOW });
  // A later backup keeps that history, and the return date does not move.
  const later = compare({ previous: earlier({ pledges: returned.document.pledges, buybacks: returned.document.buybacks }), pledges: [pledge(1), pledge(2)], buybacks: [buyback(11), buyback(12), buyback(13)] });
  assert.deepEqual(later.document.pledges[1].removal, { ...removal, returnedAt: NOW });
  assert.deepEqual(later.tracking.pledges, counts());
});

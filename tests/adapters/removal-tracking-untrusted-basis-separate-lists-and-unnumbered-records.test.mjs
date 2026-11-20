import assert from "node:assert/strict";
import test from "node:test";
import { EARLIER, NOW, OLD_LOG, buyback, compare, complete, counts, earlier, logRow, notCompared, pledge } from "./removal-tracking-loaded-with-fixture-backups.mjs";

test("no removal is claimed unless the earlier backup can be trusted and the two logs line up", () => {
  const gone = { pledges: [pledge(1), pledge(3)], buybacks: [buyback(11), buyback(13)] };
  const untouched = ({ document }) => assert.deepEqual([document.pledges.map((record) => record.pledgeId), document.buybacks.map((record) => record.buybackId)], [[1, 3], [11, 13]]);
  const both = (reason) => ({ pledges: notCompared(reason), buybacks: notCompared(reason) });
  const expectReason = (options, reason) => {
    const outcome = compare({ ...gone, ...options });
    assert.deepEqual({ pledges: outcome.tracking.pledges, buybacks: outcome.tracking.buybacks }, both(reason), reason);
    untouched(outcome);
  };
  expectReason({ previous: null }, "no-earlier-backup");
  assert.equal(compare({ ...gone, previous: null }).tracking.comparedWithExportedAt, null);
  expectReason({ previousVerified: false }, "earlier-backup-not-verified");
  expectReason({ previous: earlier({ sync: { sectionOutcomes: { pledges: complete, buybacks: complete, hangarLog: { status: "partial" } } } }) }, "earlier-hangar-log-incomplete");
  // The log was neither read nor confirmed unchanged in this collection.
  expectReason({ results: [{ section: "pledges", outcome: complete }, { section: "buybacks", outcome: complete }] }, "hangar-log-not-read");
  // The earlier log's newest entries are not in the new log as they were.
  expectReason({ hangarLog: [logRow(40), ...OLD_LOG.slice(1)] }, "hangar-log-not-aligned");
  expectReason({ hangarLog: OLD_LOG.slice(3) }, "hangar-log-not-aligned");

  // A log confirmed unchanged counts as read.
  const reused = compare({ ...gone, results: [{ section: "pledges", outcome: complete }, { section: "buybacks", outcome: complete }], reusedSections: ["hangarLog"] });
  assert.deepEqual([reused.tracking.pledges.status, reused.tracking.pledges.notReconcilable], ["compared", 1]);
  // An earlier log with no entries lines up with any log; every entry of the new one is new.
  const emptyLog = compare({ ...gone, previous: earlier({ hangarLog: [] }), hangarLog: [logRow(41, 2, "Gifted to Friend")] });
  assert.deepEqual([emptyLog.tracking.pledges, emptyLog.tracking.buybacks.notReconcilable], [counts({ missing: 1, explained: 1 }), 1]);
});

test("each list stands on its own: one that was not read or was incomplete before is not compared, the other is", () => {
  // The earlier buy-back list was incomplete, so its absences mean nothing. The hangar is still compared.
  const incomplete = compare({ previous: earlier({ sync: { sectionOutcomes: { pledges: complete, buybacks: { status: "partial" }, hangarLog: complete } } }), pledges: [pledge(1)], buybacks: [buyback(11)] });
  assert.deepEqual(incomplete.tracking.buybacks, notCompared("earlier-list-incomplete"));
  assert.deepEqual(incomplete.tracking.pledges, counts({ missing: 2, notReconcilable: 2, kept: 2 }));
  assert.deepEqual(incomplete.document.buybacks.map((record) => record.buybackId), [11]);

  // This run did not read the hangar, so the earlier hangar stands as it is, kept records included.
  const removal = { lastSeenAt: EARLIER, firstMissingAt: EARLIER, returnedAt: null };
  const previous = earlier({ pledges: [pledge(1), pledge(2, { state: "not-reconcilable", removal })] });
  const unread = compare({ previous, pledges: previous.pledges, buybacks: [buyback(11)], results: [{ section: "buybacks", outcome: complete }, { section: "hangarLog", outcome: complete }] });
  assert.deepEqual(unread.tracking.pledges, notCompared("list-not-read", 1));
  assert.deepEqual(unread.document.pledges, previous.pledges);
  assert.equal(unread.tracking.buybacks.notReconcilable, 2);

  // A list read without a trustworthy comparison still carries its kept records forward and lets one return.
  const carried = compare({ previous: earlier({ buybacks: [buyback(11), buyback(12, { state: "not-reconcilable", removal }), buyback(13, { state: "not-reconcilable", removal })] }), buybacks: [buyback(13)], previousVerified: false });
  assert.deepEqual(carried.tracking.buybacks, notCompared("earlier-backup-not-verified", 1));
  assert.deepEqual(carried.document.buybacks.map((record) => [record.buybackId, record.state, record.removal?.returnedAt ?? null]), [[13, "available", NOW], [12, "not-reconcilable", null]]);
});

test("a record without an RSI number is never matched, and one in an unused state is not claimed", () => {
  const previous = earlier({ pledges: [pledge(null), pledge(2, { state: "historical" }), pledge(3)] });
  const { document, tracking } = compare({ previous, pledges: [pledge(null, { title: "Another unnumbered pledge" })] });
  assert.deepEqual(tracking.pledges, counts({ missing: 1, notReconcilable: 1, kept: 1 }));
  assert.deepEqual(document.pledges.map((record) => [record.pledgeId, record.state]), [[null, "current"], [3, "not-reconcilable"]]);
});

import assert from "node:assert/strict";

await import("../../extension/adapters/update-delta.js");
await import("../../extension/adapters/removal-tracking.js");

const Removals = globalThis.CitizenDataRemovalTracking;
export const EARLIER = "2026-11-01T12:00:00.000Z";
export const NOW = "2026-11-19T12:00:00.000Z";
export const complete = { status: "complete" };

export const pledge = (pledgeId, extra = {}) => ({ pledgeId, recordKey: `pledge:${pledgeId}`, title: `Pledge ${pledgeId}`, state: "current", observation: { lastObservedAt: EARLIER }, ...extra });
export const buyback = (buybackId, extra = {}) => ({ buybackId, recordKey: `buyback:${buybackId}`, title: `Buy-back ${buybackId}`, state: "available", observation: { lastObservedAt: EARLIER }, ...extra });
export const logRow = (index, subjectId = 900 + index, rawDetail = "Created by Citizen, value: $10.00 USD") => ({ rawTimestamp: `Oct ${index} 2026, 4:10 pm`, subjectId, subjectName: `Subject ${subjectId}`, kind: "created", rawDetail });
// Twenty-five older log rows, newest first, shared by both backups.
export const OLD_LOG = Array.from({ length: 25 }, (_, index) => logRow(25 - index));

export function earlier(overrides = {}) {
  return {
    exportedAt: EARLIER,
    pledges: [pledge(1), pledge(2), pledge(3)],
    buybacks: [buyback(11), buyback(12), buyback(13)],
    hangarLog: OLD_LOG,
    sync: { sectionOutcomes: { pledges: complete, buybacks: complete, hangarLog: complete } },
    ...overrides
  };
}

// The new backup as the assembler hands it over: the new lists in place, and the new log.
export function compare({ previous = earlier(), pledges = [pledge(1), pledge(2), pledge(3)], buybacks = [buyback(11), buyback(12), buyback(13)], newRows = [], hangarLog, previousVerified = true, results, reusedSections = [] } = {}) {
  const document = {
    exportedAt: NOW,
    pledges: structuredClone(pledges),
    buybacks: structuredClone(buybacks),
    hangarLog: hangarLog ?? [...newRows, ...(previous?.hangarLog ?? [])],
    sync: { sectionOutcomes: { pledges: complete, buybacks: complete, hangarLog: complete } }
  };
  const read = results ?? [{ section: "pledges", outcome: complete }, { section: "buybacks", outcome: complete }, { section: "hangarLog", outcome: complete }];
  const before = JSON.stringify(previous);
  const tracking = Removals.reconcile({ document, previous, previousVerified, results: read, reusedSections, comparedAt: NOW });
  assert.equal(JSON.stringify(previous), before, "the earlier backup is never changed");
  assert.equal(document.sync.removalTracking, tracking);
  return { document, tracking };
}

export const counts = (overrides = {}) => ({ status: "compared", reason: null, missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept: 0, ...overrides });
export const notCompared = (reason, kept = 0) => ({ status: "not-compared", reason, missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept });

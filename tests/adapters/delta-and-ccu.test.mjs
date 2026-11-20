import assert from "node:assert/strict";
import test from "node:test";

await import("../../extension/adapters/hangar-log-delta.js");
await import("../../extension/adapters/ccu-reconciliation.js");
await import("../../extension/adapters/job-outcomes.js");

const Delta = globalThis.CitizenDataHangarLogDelta;
const Ccu = globalThis.CitizenDataCcuReconciliation;
const Outcomes = globalThis.CitizenDataJobOutcomes;
const event = (character, ordinal = 1, overrides = {}) => ({ fingerprint: character.repeat(64), occurrenceOrdinal: ordinal, kind: "created", parsed: { recognized: true }, ...overrides });

test("delta reconciliation establishes a baseline, finds ordered overlap, and fails closed", () => {
  const baselineEvents = [event("a"), event("b"), event("c")];
  const baseline = Delta.reconcile(baselineEvents, null, { mode: "baseline", overlapSize: 2, observedAt: "2026-11-17T00:00:00Z" });
  assert.equal(baseline.ok, true);
  const changed = Delta.reconcile([event("d"), ...baselineEvents], baseline.checkpoint, { observedAt: "2026-11-17T01:00:00Z" });
  assert.equal(changed.code, "DELTA_FOUND");
  assert.equal(changed.newEvents.length, 1);
  assert.equal(Delta.reconcile([event("e")], baseline.checkpoint).code, "LOST_ANCHOR");
  assert.equal(Delta.reconcile([event("d", 1, { kind: "unknown" }), ...baselineEvents], baseline.checkpoint).code, "UNKNOWN_EVENT_GRAMMAR");
  assert.equal(Delta.reconcile([event("d"), ...baselineEvents], baseline.checkpoint, { captureComplete: false }).code, "INCOMPLETE_CAPTURE");
});

test("CCU reconciliation preserves free steps and stops cumulative inference after unknown cost", () => {
  const oldStep = event("a", 1, {
    subjectId: 42,
    rawTimestamp: "January 1, 2026",
    parsed: { recognized: true, type: "ccuApplied", fromShip: "A", toShip: "B", cost: { amount: "0.00", currency: "USD" } }
  });
  const newStep = event("b", 1, {
    subjectId: 42,
    rawTimestamp: "February 1, 2026",
    parsed: { recognized: true, type: "ccuApplied", fromShip: "B", toShip: "C", cost: null }
  });
  const result = Ccu.reconcile({ pledgeId: 42, baseValue: { amount: "100.00", currency: "USD" } }, [newStep, oldStep]);
  assert.equal(result.history[0].cost.amount, "0.00");
  assert.equal(result.history[0].cumulativeValue.amount, "100");
  assert.equal(result.history[1].cost, null);
  assert.equal(result.history[1].cumulativeValue, null);
  assert.deepEqual(result.history[0].sourceEventKeys, ["a".repeat(64) + ":1"]);
});

test("CCU reconciliation refuses events when the pledge has no stable RSI pledge ID", () => {
  const unrelated = event("c", 1, {
    subjectId: 99,
    parsed: { recognized: true, type: "ccuApplied", fromShip: "A", toShip: "B", cost: { amount: "5.00", currency: "USD" } }
  });
  const result = Ccu.reconcile({ pledgeId: null, baseValue: { amount: "100.00", currency: "USD" } }, [unrelated]);
  assert.deepEqual(result.history, []);
  assert.deepEqual(result.finalValue, { amount: "100.00", currency: "USD" });
  assert.match(result.warnings[0], /no stable RSI pledge ID/u);
});

test("job outcome mapping owns billing total and all three ledgers", () => {
  assert.deepEqual(Outcomes.outcomesForJob("financial.billingTotal"), ["financial.billingTotal"]);
  assert.deepEqual(Outcomes.outcomesForJob("financial.ledgers"), [
    "financial.creditLedgers.storeCredit",
    "financial.creditLedgers.uec",
    "financial.creditLedgers.rec"
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

await import("../../extension/adapters/job-outcomes.js");

const Outcomes = globalThis.CitizenDataJobOutcomes;

test("dynamic organization roster job maps only to its exact organization outcome", () => {
  assert.deepEqual([...Outcomes.outcomesForJob("organizations.members.TEST")], ["organizations.members.TEST"]);
  assert.equal(Outcomes.rosterOutcomeKeyFromSection("organizations.members.TEST"), "TEST");
  assert.equal(Outcomes.rosterOutcomeKey("TEST"), "TEST");
  assert.equal(Outcomes.rosterOutcomeKeyFromSection("organizations.members.test"), null);
  assert.throws(() => Outcomes.rosterOutcomeKey(" test "), /validated organization SID/u);
  assert.throws(() => Outcomes.outcomesForJob("organizations.members.../TEST"), /No outcome mapping/u);
});

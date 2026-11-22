// The smart check at the give-up (PARSER_HARDENING.md §8.2, §9.4): it runs once, one in-step wait after the last
// refusal, and its diagnosis is stored; an adapter without it, or a run whose probe allowance is used up, gives up
// with no diagnosis.
import assert from "node:assert/strict";
import test from "node:test";
import { pacingSettings } from "./runner-under-test.mjs";
import { plain, LIMIT, harness } from "./runnergiveupharness.mjs";

// The four status results of §9.4, as the status page gives them.
const STATUS_RESULTS = [
  { status: "ok", reason: null, components: [], httpStatus: 200 },
  { status: "issue", reason: null, components: [{ name: "Platform", state: "disrupted" }], httpStatus: 200 },
  { status: "unknown", reason: "no-permission", components: [], httpStatus: null },
  { status: "unknown", reason: "unreadable", components: [], httpStatus: 503 }
];

const PROBE_STATUS = { refused: 429, answered: 200, failed: null };

test("at the give-up, one in-step wait after the last refusal, the smart check runs once and each diagnosis of §9.4 is stored", async () => {
  for (const probe of ["refused", "answered", "failed"]) {
    for (const result of STATUS_RESULTS) {
      const label = `${probe}, ${result.status} ${result.reason}`;
      const { state, job, runUntilStopped } = await harness({
        smartCheck: (current) => {
          const checkedAt = new Date(current.clock).toISOString();
          return {
            probe: { probe, httpStatus: PROBE_STATUS[probe], elapsedMs: 30 },
            status: { ...result, checkedAt },
            diagnosis: { probe, status: result.status, reason: result.reason, components: result.components, checkedAt }
          };
        }
      });
      const stopped = await runUntilStopped();
      assert.deepEqual([stopped.status, stopped.failure.code], ["failed", "RSI_RATE_LIMITED"], label);
      assert.equal(state.smartChecks.length, 1, label);
      assert.equal(state.smartChecks[0].handle, job.accountId, label);
      assert.deepEqual(state.sleeps, [pacingSettings.brakes.maximumInStepWaitMs], label);
      assert.equal(state.smartChecks[0].at - state.refusedAt, pacingSettings.brakes.maximumInStepWaitMs, label);
      const checkedAt = new Date(state.smartChecks[0].at).toISOString();
      assert.deepEqual(plain(stopped.failure.detail), { signal: LIMIT, diagnosis: { probe, status: result.status, reason: result.reason, components: result.components, checkedAt } }, label);
      const lines = plain(stopped.activityLog).filter((line) => line.kind === "smart-check");
      assert.deepEqual(lines.map((line) => [line.check, line.outcome, line.httpStatus, line.section]), [["public-page", probe, PROBE_STATUS[probe], "pledges"], ["status-page", result.status, result.httpStatus, "pledges"]], label);
      assert.deepEqual([stopped.actualRequestsByAllowance.probes, stopped.actualRequestsByAllowance.statusChecks], [1, 1], label);
    }
  }
});

test("a run whose probe allowance is used up gives up without the smart check and with no diagnosis", async () => {
  const { state, runUntilStopped } = await harness({
    // Every allowance is named, as a stored job's must be (§7.13); only the probes are used up.
    job: (value) => {
      const { accountRetries, canaryAndSessionChecks, statusChecks } = pacingSettings.requestBounds;
      return { ...value, maximumActualRequests: { baseline: 1_000, retries: accountRetries, canaryAndSessionChecks, probes: 0, statusChecks } };
    },
    smartCheck: () => assert.fail("the smart check is past its allowance")
  });
  const stopped = await runUntilStopped();
  assert.equal(stopped.failure.code, "RSI_RATE_LIMITED");
  assert.equal(plain(stopped.failure.detail).diagnosis, null);
  assert.deepEqual([state.smartChecks.length, state.sleeps.length], [0, 0]);
});

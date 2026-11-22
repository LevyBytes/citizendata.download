// A stored job's pace, request counters and allowances are checked before any request (PARSER_HARDENING.md §6.2,
// §7.13, §7.14). A state that cannot be read stops the run continuably, with a fixed message and a detail that names a
// field, never a stored value; nothing is reset to 0 or taken as unlimited. A job stored before the pace or the
// counters existed gets the first pace once, counters at 0 and the allowances of its plan.
import assert from "node:assert/strict";
import test from "node:test";
import { plain, scripted } from "./runner-fixture-scripted-pledges-job.mjs";
import { paceApi, pacingSettings } from "./runner-under-test.mjs";

const ALLOWANCES = Object.freeze({ baseline: 100, retries: 10, canaryAndSessionChecks: 10, probes: 2, statusChecks: 2 });

async function stoppedBy(change, { authorization = null } = {}) {
  const { state, repository, runner, job } = await scripted([true], { start: change });
  if (authorization) {
    const stored = await repository.getAuthorization(job.authorizationId);
    await repository.saveAuthorization({ ...stored, maximumActualRequests: authorization });
  }
  await runner.tick(job.jobId);
  return { stopped: plain(await repository.getJob(job.jobId)), sent: state.inputs.length };
}

test("a stored pace state the controller cannot read stops the run continuably before any request", async () => {
  const { stopped, sent } = await stoppedBy((value) => ({ ...value, pace: { ...value.pace, version: 9 } }));
  assert.deepEqual([stopped.status, stopped.failure.code], ["failed", "PACE_STATE_INVALID"]);
  assert.equal(sent, 0, "no request was sent");
  // A job stored before the pace controller gets the first pace once, and says so.
  const old = await scripted([true], { start: (value) => { const { pace: _pace, pendingStep: _pending, ...rest } = value; return rest; } });
  await old.runner.tick(old.job.jobId);
  const migrated = await old.repository.getJob(old.job.jobId);
  assert.equal(migrated.pace.version, 1);
  assert.ok(migrated.warnings.includes("PACE_STATE_MIGRATED"));
  assert.equal(paceApi.validatePaceState(migrated.pace, pacingSettings), null);
});

test("negative, unsafe, nonnumeric or incomplete request counters stop the run before any request", async () => {
  const counts = (value) => value.actualRequestsByAllowance;
  const cases = {
    negative: (value) => ({ ...value, actualRequestCount: -1 }),
    fractional: (value) => ({ ...value, actualRequestCount: 1.5 }),
    unsafe: (value) => ({ ...value, actualRequestCount: Number.MAX_SAFE_INTEGER + 2 }),
    nonnumeric: (value) => ({ ...value, actualRequestCount: "3" }),
    "missing total": (value) => ({ ...value, actualRequestCount: undefined }),
    "allowance not counted": (value) => { const { retries: _retries, ...rest } = counts(value); return { ...value, actualRequestsByAllowance: rest }; },
    "allowance negative": (value) => ({ ...value, actualRequestsByAllowance: { ...counts(value), baseline: -4 } }),
    "allowance unknown": (value) => ({ ...value, actualRequestsByAllowance: { ...counts(value), extra: 1 } }),
    "section nonnumeric": (value) => ({ ...value, actualRequestsBySection: { pledges: "many" } }),
    "retries negative": (value) => ({ ...value, retriedHttpRequestCount: -1 })
  };
  for (const [name, change] of Object.entries(cases)) {
    const { stopped, sent } = await stoppedBy(change);
    assert.deepEqual([stopped.status, stopped.failure.code, sent], ["failed", "REQUEST_COUNTERS_INVALID", 0], name);
    assert.equal(stopped.failure.message, "The run's stored request counts could not be read.", name);
    assert.ok(stopped.failure.detail.message.length <= 120 && !/many|-4|1\.5/u.test(stopped.failure.detail.message), name);
  }
});

test("a missing, infinite or malformed allowance stops the run; none is taken as unlimited", async () => {
  const cases = {
    infinite: { ...ALLOWANCES, baseline: Number.POSITIVE_INFINITY },
    "not a number": { ...ALLOWANCES, probes: "2" },
    negative: { ...ALLOWANCES, retries: -1 },
    missing: { baseline: 100, retries: 10, canaryAndSessionChecks: 10, probes: 2 },
    unknown: { ...ALLOWANCES, extra: 1 },
    list: [100, 10, 10, 2, 2]
  };
  for (const [name, allowances] of Object.entries(cases)) {
    for (const where of ["job", "authorization"]) {
      const { stopped, sent } = where === "job"
        ? await stoppedBy((value) => ({ ...value, maximumActualRequests: allowances }))
        : await stoppedBy((value) => value, { authorization: allowances });
      assert.deepEqual([stopped.status, stopped.failure.code, sent], ["failed", "REQUEST_COUNTERS_INVALID", 0], `${where}: ${name}`);
      assert.match(stopped.failure.detail.message, where === "job" ? /^maximumActualRequests/u : /^authorization\.maximumActualRequests/u);
    }
  }
});

test("a job stored before the request counters starts them at 0 with its plan's allowances, and sends its request", async () => {
  const older = (value) => {
    const { actualRequestCount: _count, actualRequestsBySection: _sections, actualRequestsByAllowance: _allowances, maximumActualRequests: _maximum, ...rest } = value;
    return rest;
  };
  const { stopped: migrated, sent } = await stoppedBy(older);
  assert.equal(migrated.status, "running");
  assert.equal(sent, 1);
  assert.deepEqual(Object.keys(migrated.maximumActualRequests).sort(), Object.keys(ALLOWANCES).sort());
  assert.ok(Object.values(migrated.maximumActualRequests).every((bound) => Number.isSafeInteger(bound) && bound >= 0), "every allowance is a finite count");
  assert.equal(migrated.actualRequestCount, 1, "the one request sent is counted from 0");
  assert.equal(migrated.actualRequestsByAllowance.baseline, 1);
});

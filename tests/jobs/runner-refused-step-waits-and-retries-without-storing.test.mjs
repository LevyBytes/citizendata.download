// A refused attempt waits and is tried again without storing anything (PARSER_HARDENING.md R6, §7.4, §7.6, §7.7): no
// page, receipt or staged result; the step caps stay as they were; the attempt's request lines, a free-retry or
// rate-limited line and the pace are stored in one transaction; a pause that arrived meanwhile is kept.
import assert from "node:assert/strict";
import test from "node:test";
import { LIMIT, TIMEOUT, plain, scripted } from "./runner-fixture-scripted-pledges-job.mjs";

test("a refusal waits and tries the same step again: no page, receipt or staged result, and the step caps stay", async () => {
  const { state, repository, runner, job } = await scripted([LIMIT, true]);
  assert.equal((await runner.tick(job.jobId)).ok, true);
  const waiting = await repository.getJob(job.jobId);
  assert.equal(waiting.status, "running");
  assert.deepEqual([waiting.pace.factor, waiting.pace.wall, waiting.pace.warning, waiting.pace.attempt], [4, 2, "limited", 1]);
  assert.equal(waiting.nextEligibleAt, waiting.pace.retryNotBefore);
  assert.equal(Date.parse(waiting.nextEligibleAt), state.clock + 3750);
  assert.deepEqual([waiting.requestCount, waiting.requestsBySection.pledges ?? 0, waiting.retriedHttpRequestCount], [0, 0, 1]);
  assert.equal(repository.inspect().pages.size, 0, "no page");
  assert.equal(repository.inspect().receipts.size, 0, "no receipt");
  assert.deepEqual(plain((await repository.getStagedRun(job.runId)).results), [], "no staged result");
  const lines = plain(waiting.activityLog).slice(-2);
  assert.deepEqual(lines.map((line) => line.kind), ["request-completed", "rate-limited"]);
  assert.deepEqual([lines[1].signal.code, lines[1].waitMs, lines[1].factor, lines[1].attempt], ["RSI_HTML_HTTP_429", 3750, 4, 1]);
  assert.equal(lines[1].signal.rsiMessage, undefined, "an activity line never carries RSI's message");
  // The refused attempt is counted in the pace history.
  const [history] = plain(await repository.listPaceHistory());
  assert.deepEqual([history.pacing.refusedRequests, history.pacing.acceptedRequests, history.pacing.signalCounts[0].code], [1, 0, "RSI_HTML_HTTP_429"]);

  // Before its time the step waits; at its time the same step is sent again and stored.
  assert.deepEqual(plain(await runner.tick(job.jobId)), { ok: true, waiting: true, eligibleAt: state.clock + 3750 });
  state.clock += 3750;
  assert.equal((await runner.tick(job.jobId)).ok, true);
  assert.deepEqual(state.inputs.map((input) => input.cursor), [null, null], "the same step, from the same position");
  const stored = await repository.getJob(job.jobId);
  assert.deepEqual([stored.requestCount, stored.pace.attempt, stored.pace.refusingSince, repository.inspect().pages.size], [1, 0, null, 1]);
});

test("rule 8: one passing failure is tried once more with the pace unchanged; a second before a stored step is a refusal", async () => {
  const { state, repository, runner, job } = await scripted([TIMEOUT, TIMEOUT, true]);
  const before = plain((await repository.getJob(job.jobId)).pace);
  await runner.tick(job.jobId);
  const free = await repository.getJob(job.jobId);
  for (const key of ["factor", "wall", "warning", "attempt", "refusingSince"]) assert.deepEqual(free.pace[key], before[key], key);
  assert.ok(free.pace.freeRetryAt);
  assert.deepEqual(plain(free.activityLog.at(-1)).kind, "free-retry");
  assert.equal(Date.parse(free.nextEligibleAt), state.clock + 3750);
  state.clock += 3750;
  await runner.tick(job.jobId);
  const refused = await repository.getJob(job.jobId);
  assert.deepEqual([refused.pace.factor, refused.pace.wall, refused.pace.warning], [4, 2, "limited"]);
  assert.equal(plain(refused.activityLog.at(-1)).kind, "rate-limited");
});

test("a pause that arrives while a refused attempt is in flight is kept with the wait", async () => {
  const { state, repository, runner, job } = await scripted([LIMIT, true]);
  state.during = async () => { await runner.pause(job.jobId); };
  await runner.tick(job.jobId);
  const paused = await repository.getJob(job.jobId);
  assert.equal(paused.status, "paused");
  assert.equal(paused.pace.attempt, 1);
  // Resume keeps the pending wait, and paused time never counts as good.
  state.during = null;
  state.clock += 1000;
  await runner.resume(job.jobId);
  const resumed = await repository.getJob(job.jobId);
  assert.equal(resumed.nextEligibleAt, paused.pace.retryNotBefore);
  assert.deepEqual([resumed.pace.goodSince, resumed.pace.periodsUsed], [null, 0]);
});

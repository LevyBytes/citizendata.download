// Giving up for the time being, the run's lifetime and the Resume lease (PARSER_HARDENING.md §7.4, §7.11, §7.13,
// §8, §12.4, F9, F10): a ban gives up past 30 minutes with no accepted answer, ready to continue; a wait that would
// pass the authorization's end stops before it; an authorization that ends while the run is slowed is the same
// planned stop; a pause of 31 minutes resumes; an allowance of actual requests that is used up sends nothing more.
import assert from "node:assert/strict";
import test from "node:test";
import { acceptedInput, authorization as issuingApi, proposal } from "./authorization-loaded-with-fixture-proposal.mjs";
import { authorizationApi } from "./runner-under-test.mjs";
import { plain, LIMIT, harness } from "./runnergiveupharness.mjs";

const MINUTE = 60_000;

test("a ban gives up for the time being past 30 minutes without an accepted answer: RSI_RATE_LIMITED, ready to continue", async () => {
  const { state, repository, runUntilStopped } = await harness();
  const startedAt = state.clock;
  const stopped = await runUntilStopped();
  assert.deepEqual([stopped.status, stopped.failure.code, stopped.failure.message], ["failed", "RSI_RATE_LIMITED", "RSI kept refusing requests."]);
  assert.deepEqual(plain(stopped.failure.detail), { signal: LIMIT, diagnosis: null });
  // Every run starts at factor 2, so the ban gives up after 12 refused requests, about 26 minutes in (§6.6 C).
  assert.ok(state.requests >= 12 && state.requests <= 13, `${state.requests} refused requests`);
  const minutes = (state.clock - startedAt) / MINUTE;
  assert.ok(minutes > 20 && minutes < 30, `gave up ${minutes} minutes in`);
  assert.equal(repository.inspect().pages.size, 0, "no refused attempt stored a page");
  assert.equal(stopped.requestCount, 0);
});

test("a wait that would end past the authorization's end, less its margin, stops the run before it", async () => {
  const { repository, runUntilStopped } = await harness({ expiresInMs: 3 * MINUTE, idleTtlMs: 3 * MINUTE });
  const stopped = await runUntilStopped();
  assert.deepEqual([stopped.status, stopped.failure.code, stopped.failure.message], ["failed", "RUN_LIFETIME_REACHED", "The run reached its time limit."]);
  assert.equal(plain(stopped.failure.detail).signal.code, "RSI_HTML_HTTP_429");
  assert.equal(repository.inspect().pages.size, 0);
});

test("an authorization that ends while the run is slowed is the planned stop; at the baseline it stays the expiry it was", async () => {
  const slowed = await harness({ expiresInMs: 2 * MINUTE, idleTtlMs: 2 * MINUTE });
  slowed.state.clock += 3 * MINUTE;
  await slowed.runner.tick(slowed.job.jobId);
  assert.equal((await slowed.repository.getJob(slowed.job.jobId)).failure.code, "RUN_LIFETIME_REACHED");
  const fast = await harness({ expiresInMs: 2 * MINUTE, idleTtlMs: 2 * MINUTE, job: (value) => ({ ...value, pace: { ...value.pace, factor: 1 } }) });
  fast.state.clock += 3 * MINUTE;
  await fast.runner.tick(fast.job.jobId);
  assert.equal((await fast.repository.getJob(fast.job.jobId)).failure.code, "AUTHORIZATION_EXPIRED");
});

test("a pause of 31 minutes resumes: Resume renews the idle lease of the paused run, and only Resume does", async () => {
  const { state, repository, runner, job, auth } = await harness({ idleTtlMs: 30 * MINUTE });
  state.refusing = false;
  await runner.tick(job.jobId);
  await runner.pause(job.jobId);
  state.clock += 31 * MINUTE;
  assert.equal(authorizationApi.validateAuthorization(await repository.getAuthorization(auth.authorizationId), {}, state.clock).code, "AUTHORIZATION_IDLE_EXPIRED");
  assert.equal((await runner.resume(job.jobId)).ok, true);
  const renewed = await repository.getAuthorization(auth.authorizationId);
  assert.equal(Date.parse(renewed.idleExpiresAt), state.clock + 30 * MINUTE);
  assert.equal(authorizationApi.validateAuthorization(renewed, {}, state.clock).ok, true);
  assert.equal((await runner.tick(job.jobId)).ok, true);
  assert.equal((await repository.getJob(job.jobId)).requestCount, 2, "the resumed run takes its next step");
  // The lease is not renewed for a revoked or consumed authorization, nor past its hard expiry.
  for (const change of [{ revokedAt: new Date(state.clock).toISOString() }, { consumedAt: new Date(state.clock).toISOString() }, { expiresAt: new Date(state.clock).toISOString() }]) {
    assert.equal(authorizationApi.resumeLease({ ...renewed, ...change }, state.clock).ok, false);
  }
});

test("an allowance of actual requests that is used up sends nothing more and stops with a bounded failure", async () => {
  const { state, repository, runner, job } = await harness({ job: (value) => ({ ...value, maximumActualRequests: { baseline: 1, retries: 0, canaryAndSessionChecks: 0, probes: 0, statusChecks: 0 } }) });
  // The first request is the plan's own; the second would be a retry, whose allowance is 0.
  await runner.tick(job.jobId);
  assert.equal(state.requests, 1);
  state.clock = Date.parse((await repository.getJob(job.jobId)).nextEligibleAt);
  await runner.tick(job.jobId);
  assert.equal(state.requests, 1, "the request past its allowance was not sent");
  const stopped = await repository.getJob(job.jobId);
  assert.deepEqual([stopped.status, stopped.failure.code, stopped.failure.detail.allowance], ["failed", "ACTUAL_REQUEST_LIMIT_EXCEEDED", "retries"]);
  assert.deepEqual([stopped.actualRequestCount, stopped.actualRequestsByAllowance.baseline, stopped.actualRequestsByAllowance.retries], [1, 1, 0]);
  // The authorization's bound holds over a larger one on the job: the run never sends more than it was authorized for.
  const bounded = await harness({
    job: (value) => ({ ...value, maximumActualRequests: { baseline: 10, retries: 10, canaryAndSessionChecks: 0, probes: 0, statusChecks: 0 } }),
    authorization: (value) => ({ ...value, maximumActualRequests: { baseline: 1, retries: 0, canaryAndSessionChecks: 0, probes: 0, statusChecks: 0 } })
  });
  await bounded.runner.tick(bounded.job.jobId);
  bounded.state.clock = Date.parse((await bounded.repository.getJob(bounded.job.jobId)).nextEligibleAt);
  await bounded.runner.tick(bounded.job.jobId);
  assert.equal(bounded.state.requests, 1);
  assert.equal((await bounded.repository.getJob(bounded.job.jobId)).failure.detail.allowance, "retries");
  // The authorization is issued with the bounds, and refuses bounds it cannot read.
  const issued = issuingApi.createAuthorization(proposal(), acceptedInput({ maximumActualRequests: { baseline: 4, retries: 2, canaryAndSessionChecks: 1, probes: 1, statusChecks: 1 } }));
  assert.deepEqual(plain(issued.value.maximumActualRequests), { baseline: 4, retries: 2, canaryAndSessionChecks: 1, probes: 1, statusChecks: 1 });
  assert.equal(issuingApi.createAuthorization(proposal(), acceptedInput({ maximumActualRequests: { baseline: -1 } })).code, "INVALID_REQUEST_ALLOWANCES");
});

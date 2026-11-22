// The status feed's cache and its races (PARSER_HARDENING.md §7.5, §9.3, §12.10, R15, D40): the durable cache
// outlives a worker restart, so one cache period holds one real request; callers at the same time share one
// request; a late result never overwrites a newer one, never reaches a job whose warning cleared, another run's job
// or an ended job. An unresolved issue always names a component.
import assert from "node:assert/strict";
import test from "node:test";
import { databaseApi, pacingSettings } from "./runner-under-test.mjs";
import { plain, flush, statusHost, checkerOf, page, storedJob } from "./runnerstatusfeedcache.mjs";

const CACHE_MS = pacingSettings.smartCheck.statusPageCacheMs;

test("the cache outlives a worker restart: one cache period holds one real request", async () => {
  const repository = databaseApi.createMemoryRepository();
  const clock = { now: Date.parse("2026-11-21T12:00:00Z") };
  const host = statusHost("ok");
  assert.equal(plain(await checkerOf(repository, host, clock).checkStatusPage()).status, "ok");
  // The worker stops; its successor has a new checker and the same repository.
  clock.now += CACHE_MS - 1;
  const restarted = checkerOf(repository, host, clock);
  assert.equal(plain(await restarted.checkStatusPage()).checkedAt, "2026-11-21T12:00:00.000Z");
  assert.equal(host.requests.length, 1, "the cached answer is served");
  clock.now += 1;
  await restarted.checkStatusPage();
  assert.equal(host.requests.length, 2, "past the cache period it is read again");
});

test("callers at the same time share one request", async () => {
  const repository = databaseApi.createMemoryRepository();
  const clock = { now: Date.parse("2026-11-21T12:00:00Z") };
  const host = statusHost("issue-system", { held: true });
  const checker = checkerOf(repository, host, clock);
  const callers = [checker.checkStatusPage(), checker.checkStatusPage(), checker.checkStatusPage()];
  await flush();
  assert.equal(host.requests.length, 1);
  host.release();
  const results = (await Promise.all(callers)).map(plain);
  assert.deepEqual(results.map((result) => result.status), ["issue", "issue", "issue"]);
  await checker.checkStatusPage();
  assert.equal(host.requests.length, 1, "the next caller reads the cache");
});

test("a late result never overwrites a newer one, never reaches a cleared warning, another run or an ended job", async () => {
  const repository = databaseApi.createMemoryRepository();
  const newer = await storedJob(repository, { statusPage: page("2026-11-21T12:05:00.000Z") });
  const revision = await repository.getStatusRevision();
  assert.equal(await repository.mergeStatusPage({ jobId: newer.jobId, runId: newer.runId, statusPage: page("2026-11-21T12:00:00.000Z", "ok") }), false);
  assert.equal(await repository.mergeStatusPage({ jobId: newer.jobId, runId: newer.runId, statusPage: page("2026-11-21T12:05:00.000Z", "ok") }), false, "an equal time is not newer");
  assert.deepEqual(plain((await repository.getJob(newer.jobId)).pace.statusPage), page("2026-11-21T12:05:00.000Z"));
  assert.equal(await repository.getStatusRevision(), revision, "nothing changed, so the revision is the same");
  const cleared = await storedJob(repository, { warning: null });
  assert.equal(await repository.mergeStatusPage({ jobId: cleared.jobId, runId: cleared.runId, statusPage: page("2026-11-21T12:10:00.000Z") }), false);
  assert.deepEqual([(await repository.getJob(cleared.jobId)).pace.warning, (await repository.getJob(cleared.jobId)).pace.statusPage], [null, null]);
  const other = await storedJob(repository, { status: "paused", runId: "another-run" });
  assert.equal(await repository.mergeStatusPage({ jobId: other.jobId, runId: "this-run", statusPage: page("2026-11-21T12:10:00.000Z") }), false);
  for (const status of ["cancelled", "failed", "complete", "partial"]) {
    const ended = await storedJob(repository, { status });
    const before = plain(await repository.getJob(ended.jobId));
    assert.equal(await repository.mergeStatusPage({ jobId: ended.jobId, runId: ended.runId, statusPage: page("2026-11-21T12:10:00.000Z") }), false, status);
    assert.deepEqual(plain(await repository.getJob(ended.jobId)), before, `${status} is untouched`);
  }
  assert.equal(await repository.mergeStatusPage({ jobId: "no-such-job", runId: newer.runId, statusPage: page("2026-11-21T12:10:00.000Z") }), false);
  // A newer result for a job that still warns changes its status page and its log, and nothing else.
  const paused = await storedJob(repository, { status: "paused", statusPage: page("2026-11-21T12:05:00.000Z") });
  const pausedBefore = plain(await repository.getJob(paused.jobId));
  const activity = { kind: "smart-check", at: "2026-11-21T12:10:00.000Z", section: "pledges", check: "status-page", outcome: "issue", httpStatus: 200 };
  assert.equal(await repository.mergeStatusPage({ jobId: paused.jobId, runId: paused.runId, statusPage: page("2026-11-21T12:10:00.000Z"), activity }), true);
  const after = plain(await repository.getJob(paused.jobId));
  assert.deepEqual(after.pace, { ...pausedBefore.pace, statusPage: page("2026-11-21T12:10:00.000Z") });
  assert.deepEqual(after.activityLog, [...pausedBefore.activityLog, { ...activity, seq: (pausedBefore.activitySequence ?? 0) + 1 }]);
  const { pace: _pace, activityLog: _log, activitySequence: _sequence, ...rest } = after;
  const { pace: _paceBefore, activityLog: _logBefore, activitySequence: _sequenceBefore, ...restBefore } = pausedBefore;
  assert.deepEqual(rest, restBefore);
  assert.ok(await repository.getStatusRevision() > revision);
});

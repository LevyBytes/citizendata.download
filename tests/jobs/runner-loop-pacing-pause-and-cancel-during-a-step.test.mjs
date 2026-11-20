import assert from "node:assert/strict";
import test from "node:test";
import { steppedJob } from "./runner-fixture-stepped-job.mjs";

test("the run loop takes steps back to back at the job's own pacing, without a scheduler", async () => {
  const scheduled = [];
  const { runner, repository, job, state } = await steppedJob({ steps: 3, schedule: (value) => scheduled.push(value.jobId) });
  const loop = runner.run(job.jobId);
  assert.equal(runner.isRunning(job.jobId), true);
  assert.equal(runner.run(job.jobId), loop, "a second call while the loop is active must not start another loop");
  const outcome = await loop;
  assert.equal(outcome.ok, true);
  assert.equal(outcome.job.status, "complete");
  assert.equal(state.calls, 3);
  assert.equal(state.maximumInFlight, 1);
  // 900 ms between the first and second step and again before the third; nothing to wait for after the last.
  assert.deepEqual(state.sleeps, [900, 900]);
  assert.deepEqual(scheduled, []);
  assert.equal(runner.isRunning(job.jobId), false);
  assert.equal((await repository.getSnapshot("account-1")).document.pledges.length, 3);
});

test("a pause that arrives during a step is kept, the step's progress is saved, and resume continues from it", async () => {
  let pausedAt = null;
  const { runner, repository, job, state } = await steppedJob({
    steps: 3,
    beforeRequest: async ({ call }) => {
      if (call === 2 && pausedAt === null) {
        pausedAt = call;
        assert.equal((await runner.pause(job.jobId)).job.status, "paused");
      }
    }
  });
  const outcome = await runner.run(job.jobId);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.job.status, "paused");
  const paused = await repository.getJob(job.jobId);
  assert.equal(paused.status, "paused", "the step's own save must not write the job back to running");
  assert.equal(paused.requestCount, 2, "the step that was in flight keeps its progress");
  assert.equal(paused.cursorBySection.pledges.page, 3);
  assert.equal(state.calls, 2, "no further step starts while paused");
  assert.equal(runner.isRunning(job.jobId), false);
  assert.equal((await runner.tick(job.jobId)).code, "JOB_NOT_RUNNING");

  assert.equal((await runner.resume(job.jobId)).job.status, "running");
  await runner.run(job.jobId);
  assert.equal(state.calls, 3);
  assert.equal((await repository.getJob(job.jobId)).status, "complete");
  assert.equal((await repository.getSnapshot("account-1")).document.pledges.length, 3);
});

test("a cancel that arrives during a step stops it before its next request and nothing from it is stored", async () => {
  const { runner, repository, job, auth, state } = await steppedJob({
    steps: 3,
    requestsPerStep: 2,
    beforeRequest: async ({ call, request }) => {
      if (call === 2 && request === 1) assert.equal((await runner.cancel(job.jobId)).job.status, "cancelled");
    }
  });
  const outcome = await runner.run(job.jobId);
  assert.equal(outcome.ok, false);
  const cancelled = await repository.getJob(job.jobId);
  assert.equal(cancelled.status, "cancelled", "a failing or finishing step must not replace the cancellation");
  assert.equal(cancelled.failure, null);
  assert.equal(state.requests, 3, "two requests in the first step, one in the second, and none after the cancel");
  assert.equal(cancelled.requestCount, 1, "the cancelled step records no progress");
  // A cancelled run can be neither opened nor continued, so nothing it collected is kept.
  assert.equal((await repository.getStagedRun(job.runId)).results.length, 0, "a cancelled run keeps no records");
  assert.equal(repository.inspect().pages.size, 0);
  assert.equal(repository.inspect().receipts.size, 1, "the cancelled step leaves no receipt");
  assert.ok((await repository.getAuthorization(auth.authorizationId)).revokedAt);
  assert.ok(!await repository.getSnapshot("account-1"), "a cancelled run promotes nothing");
  assert.equal(runner.isRunning(job.jobId), false);
  assert.equal(state.events.filter((event) => event.endsWith(":failed")).length, 0);
});

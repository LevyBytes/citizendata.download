import assert from "node:assert/strict";
import test from "node:test";
import { steppedJob } from "./runner-fixture-stepped-job.mjs";

test("a cancel that arrives while a step's last request is in flight keeps the run cancelled and revoked", async () => {
  const { runner, repository, job, auth, state } = await steppedJob({
    steps: 3,
    beforeRequest: async ({ call }) => {
      // The only request of the second step has been sent; the user cancels before its answer is processed.
      if (call === 2) await runner.cancel(job.jobId);
    }
  });
  const outcome = await runner.run(job.jobId);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "JOB_TERMINAL");
  const cancelled = await repository.getJob(job.jobId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.requestCount, 1, "the step that was answered after the cancel records no progress");
  const staged = await repository.getStagedRun(job.runId);
  assert.equal(staged.results.length, 0, "a cancelled run keeps no records");
  assert.equal(repository.inspect().receipts.size, 1, "and the step leaves no receipt");
  assert.equal(staged.runReceipt.status, "cancelled");
  assert.ok((await repository.getAuthorization(auth.authorizationId)).revokedAt, "the step must not write the revoked authorization back");
  assert.equal(state.calls, 2);
});

test("a resume that lands while the loop is finishing a paused step is not lost", async () => {
  let resumed = false;
  const { runner, repository, job, state } = await steppedJob({
    steps: 3,
    beforeRequest: async ({ call }) => {
      if (call === 1) await runner.pause(job.jobId);
    },
    // The step reports its saved progress while the job is paused; the user resumes at that moment.
    onStatus: async (event, activeRunner) => {
      if (event.event === "progress" && event.job.status === "paused" && !resumed) {
        resumed = true;
        await activeRunner.resume(job.jobId);
      }
    },
    // The host starts the loop for a resumed job, as the service worker does.
    schedule: (scheduled, activeRunner) => { void activeRunner.run(scheduled.jobId); }
  });
  const outcome = await runner.run(job.jobId);
  assert.equal(resumed, true);
  assert.equal(outcome.job.status, "complete", "the loop must take the resumed job to completion instead of exiting");
  assert.equal(state.calls, 3);
  assert.equal(state.maximumInFlight, 1);
  assert.equal((await repository.getJob(job.jobId)).status, "complete");
});

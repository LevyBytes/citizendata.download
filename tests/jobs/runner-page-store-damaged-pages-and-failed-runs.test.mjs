import assert from "node:assert/strict";
import test from "node:test";
import { pagedJob } from "./runner-page-store-fixture-paged-job.mjs";
import { RUN_ID, plain, sha256 } from "./runner-page-store-loaded-with-fixture-authorization.mjs";

test("a stored page that fails its SHA-256, or is missing, makes the section start over from its first page", async () => {
  for (const damage of ["altered", "missing", "not JSON"]) {
    const { state, repository, job, startWorker, step, pages } = await pagedJob([10, 10, 10, 10, 10, 1]);
    const first = startWorker();
    await step(first);
    await step(first);
    const store = repository.inspect().pages;
    const key = `${RUN_ID}|pledges|000001`;
    if (damage === "altered") store.set(key, { ...store.get(key), text: store.get(key).text.replace("row-1", "row-X") });
    if (damage === "missing") store.delete(key);
    if (damage === "not JSON") store.set(key, { ...store.get(key), text: "{", sha256: sha256("{") });

    const second = startWorker();
    const restartedStep = await step(second);
    assert.equal(restartedStep.ok, true, damage);
    const afterRestart = await repository.getJob(job.jobId);
    assert.deepEqual(plain(afterRestart.storedStepsBySection), { pledges: 1 }, damage);
    assert.deepEqual(plain(afterRestart.recordsBySection), { pledges: 10 }, damage);
    assert.equal(afterRestart.requestsBySection.pledges, 3, "the steps already spent on the section still count toward its limit");
    assert.deepEqual(pages().map((record) => record.step), [1], damage);
    const steps = state.log.filter((entry) => entry.kind === "step");
    assert.deepEqual([steps[2].cursor, steps[2].sectionState], [null, null], "the section was collected again from its first page");
    assert.equal(state.log.some((entry) => entry.kind === "rebuild"), false, "damaged pages are never merged");
    assert.deepEqual(plain(afterRestart.activityLog).filter((entry) => entry.kind === "section-started").length, 2);
    while ((await step(second)).job?.status === "running") { /* Run to the end. */ }
    assert.equal((await repository.getJob(job.jobId)).status, "complete", damage);
  }
});

test("a run that fails stores the unfinished section's rows with the failure, and keeps its pages for a continuation", async () => {
  const { state, repository, job, startWorker, step, pages } = await pagedJob([10, 10, { fail: true }]);
  const runner = startWorker();
  await step(runner);
  await step(runner);
  const failed = await step(runner);
  assert.equal(failed.ok, false);
  assert.equal(failed.job.failure.code, "RSI_READ_FAILED");
  const staged = plain(await repository.getStagedRun(job.runId));
  assert.equal(staged.status, "failed");
  assert.equal(staged.runReceipt.status, "failed");
  assert.deepEqual(staged.results.map((result) => [result.section, result.outcome.status, result.value.length, result.outcome.pagesOrBatches]), [["pledges", "partial", 20, 2]]);
  assert.deepEqual(state.log.filter((entry) => entry.kind === "partial"), [{ kind: "partial", rows: 20 }]);
  assert.deepEqual(pages().map((record) => record.step), [1, 2], "the pages stay for the run that continues this one");
  const stored = await repository.getJob(job.jobId);
  assert.equal(stored.status, "failed");
  assert.deepEqual(plain(stored.storedStepsBySection), { pledges: 2 });

  // The same holds when the worker that reports the failure had to read the pages back first.
  const again = await pagedJob([10, 10, { fail: true }]);
  await again.step(again.startWorker());
  await again.step(again.startWorker());
  await again.step(again.startWorker());
  assert.deepEqual(plain((await again.repository.getStagedRun(again.job.runId)).results), staged.results);

  // A run that fails on the first step of a section has nothing of it to store.
  const early = await pagedJob([{ fail: true }]);
  await early.step(early.startWorker());
  assert.deepEqual(plain((await early.repository.getStagedRun(early.job.runId)).results), []);
  assert.equal(early.state.log.some((entry) => entry.kind === "partial"), false);
});

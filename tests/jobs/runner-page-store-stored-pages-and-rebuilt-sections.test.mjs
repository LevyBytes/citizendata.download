import assert from "node:assert/strict";
import test from "node:test";
import { pagedJob } from "./runner-page-store-fixture-paged-job.mjs";
import { RUN_ID, plain, sha256 } from "./runner-page-store-loaded-with-fixture-authorization.mjs";

test("each step stores its own page once with its progress, and the section is normalized once at its end", async () => {
  const { state, repository, job, startWorker, step, pages } = await pagedJob([10, 10, 3]);
  const runner = startWorker();
  assert.equal(job.collectionId, RUN_ID, "a new run's stored pages are named by the run");

  assert.equal((await step(runner)).ok, true);
  const afterFirst = await repository.getJob(job.jobId);
  assert.deepEqual(plain(afterFirst.storedStepsBySection), { pledges: 1 });
  assert.deepEqual(plain(afterFirst.recordsBySection), { pledges: 10 });
  assert.equal(JSON.stringify(afterFirst).includes("row-"), false, "the job record holds a position, never collected rows");
  let stored = pages();
  assert.deepEqual(stored.map((record) => [record.pageKey, record.step, record.checkpoint]), [[`${RUN_ID}|pledges|000001`, 1, false]]);
  assert.equal(stored[0].sha256, sha256(stored[0].text));
  assert.equal(JSON.parse(stored[0].text).raw.length, 10, "a page holds the rows of its own step");
  assert.equal((await repository.getStagedRun(job.runId)).results.length, 0, "an unfinished section stages nothing");

  assert.equal((await step(runner)).ok, true);
  stored = pages();
  assert.deepEqual(stored.map((record) => record.step), [1, 2]);
  assert.equal(JSON.parse(stored[1].text).raw.length, 10, "the second page does not repeat the first");
  assert.deepEqual(plain((await repository.getJob(job.jobId)).recordsBySection), { pledges: 20 });

  const finished = await step(runner);
  assert.equal(finished.job.status, "complete");
  assert.equal(pages().length, 0, "a finished section keeps none of its pages");
  assert.deepEqual(plain((await repository.getSnapshot("account-1")).document.pledges).map((row) => row.recordKey), Array.from({ length: 23 }, (_, index) => `row-${index + 1}`));
  assert.deepEqual(state.log.filter((entry) => entry.kind !== "step"), [{ kind: "normalize", rows: 23 }], "nothing was rebuilt and the section was normalized once");
  // The collector was handed the rows gathered so far from memory on every step.
  assert.deepEqual(state.log.filter((entry) => entry.kind === "step").map((entry) => entry.sectionState?.raw.length ?? 0), [0, 10, 20]);
  assert.equal(repository.inspect().receipts.size, 3);
  // The finished document is kept once, as the saved backup.
  assert.deepEqual(Object.keys(plain(await repository.getStagedRun(job.runId))).filter((key) => ["results", "document"].includes(key)), []);
  const completed = await repository.getJob(job.jobId);
  assert.deepEqual([plain(completed.cursorBySection), plain(completed.storedStepsBySection)], [{}, {}]);
});

test("a worker that starts over rebuilds the section from its stored pages and finishes with the same result", async () => {
  const uninterrupted = await pagedJob([10, 10, 10, 4]);
  const one = uninterrupted.startWorker();
  for (let index = 0; index < 4; index += 1) await uninterrupted.step(one);

  const restarted = await pagedJob([10, 10, 10, 4]);
  await restarted.step(restarted.startWorker());
  await restarted.step(restarted.startWorker());
  const third = restarted.startWorker();
  await restarted.step(third);
  const finished = await restarted.step(third);
  assert.equal(finished.job.status, "complete");
  assert.deepEqual(restarted.state.log.filter((entry) => entry.kind === "rebuild"), [{ kind: "rebuild", pages: 1 }, { kind: "rebuild", pages: 2 }], "each new worker rebuilt once; the worker that kept running did not");
  assert.deepEqual(
    restarted.state.log.filter((entry) => entry.kind === "step").map((entry) => [entry.cursor, entry.sectionState]),
    uninterrupted.state.log.filter((entry) => entry.kind === "step").map((entry) => [entry.cursor, entry.sectionState]),
    "every step saw the same position and the same gathered rows as in a run that was never interrupted"
  );
  assert.deepEqual(plain((await restarted.repository.getSnapshot("account-1")).document), plain((await uninterrupted.repository.getSnapshot("account-1")).document));
});

test("a step that replaces the gathered rows is stored whole and makes the earlier pages redundant", async () => {
  const { state, repository, job, startWorker, step, pages } = await pagedJob([10, { rows: 5, checkpoint: true }, 5, 2]);
  const runner = startWorker();
  await step(runner);
  await step(runner);
  let stored = pages();
  assert.deepEqual(stored.map((record) => [record.step, record.checkpoint]), [[2, true]]);
  assert.equal(JSON.parse(stored[0].text).raw.length, 15);
  assert.deepEqual(plain((await repository.getJob(job.jobId)).storedStepsBySection), { pledges: 2 });
  await step(runner);
  stored = pages();
  assert.deepEqual(stored.map((record) => [record.step, record.checkpoint]), [[2, true], [3, false]]);

  // A new worker rebuilds from the whole-state page and the page after it.
  const finished = await step(startWorker());
  assert.equal(finished.job.status, "complete");
  assert.deepEqual(state.log.filter((entry) => entry.kind === "rebuild"), [{ kind: "rebuild", pages: 2 }]);
  assert.equal((await repository.getSnapshot("account-1")).document.pledges.length, 22);
});

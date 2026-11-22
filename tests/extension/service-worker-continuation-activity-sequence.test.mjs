// A continuation keeps the failed run's activity log, a full window of 20 lines, and numbers its own lines after every
// number that log holds (PARSER_HARDENING.md §12.5); a job stored before the sequence existed has it taken from its log.
import assert from "node:assert/strict";
import test from "node:test";
import { failedBuild } from "./failed-build-in-buybacks.mjs";

const lineKey = (line) => JSON.stringify(line);

async function continueAndCheck({ withoutStoredSequence }) {
  const { harness, tab, job } = await failedBuild();
  assert.equal(job.activityLog.length, 20, "the failed run left a full window of activities");
  if (withoutStoredSequence) {
    const older = { ...job };
    delete older.activitySequence;
    await harness.repository.saveJob(older);
  }
  const retained = new Set(job.activityLog.map(lineKey));
  const highestRetained = Math.max(...job.activityLog.map((line) => line.seq));
  const continued = await tab.request("CONTINUE_PARTIAL");
  assert.equal(continued.code, "RUN_STARTED", continued.message);
  const continuationId = harness.state().activeJobId;
  await harness.advanceBy(5_000);
  const running = await harness.repository.getJob(continuationId);
  const added = running.activityLog.filter((line) => !retained.has(lineKey(line)));
  assert.ok(added.length > 0, "the continuation logged its own activity");
  assert.ok(added[0].seq > highestRetained, `the first continuation activity is ${added[0].seq}, the retained log reaches ${highestRetained}`);
  assert.ok(running.activitySequence >= Math.max(...running.activityLog.map((line) => line.seq)));
  assert.equal((await harness.finishJob()).status, "complete");
  const finished = await harness.repository.getJob(continuationId);
  const numbers = finished.activityLog.map((line) => line.seq);
  for (let index = 1; index < numbers.length; index += 1) assert.ok(numbers[index] > numbers[index - 1], `activity ${numbers[index]} follows ${numbers[index - 1]}`);
  // The dashboard sees the same numbers, each once.
  const shown = (await tab.status()).activeJob.activityLog.map((line) => line.seq);
  assert.equal(new Set(shown).size, shown.length);
}

test("a continuation numbers its first activity after every number of a full retained log", async () => {
  await continueAndCheck({ withoutStoredSequence: false });
});

test("a continuation of a job stored before the sequence existed takes the sequence from the retained log", async () => {
  await continueAndCheck({ withoutStoredSequence: true });
});

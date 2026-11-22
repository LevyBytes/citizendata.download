// Durable request slots (PARSER_HARDENING.md §6.3, F19, F20): a lane gap longer than an in-step wait is never
// shortened. The step stops at it, its answers so far are kept as a checksummed pending page, and the next slot is
// sent at its time, never before; every sliding window from one second to ten minutes holds no more requests than
// the schedule, and a worker restart goes on from the kept answers without asking again. The real runner, live
// runtime and RSI adapter run on one clock.
import assert from "node:assert/strict";
import test from "node:test";
import { pacingSettings } from "./runner-under-test.mjs";
import { plain, WINDOWS_MS, pageOf, buybackRun, busiest } from "./durableslotsbuybackrun.mjs";

const IN_STEP_WAIT_MS = pacingSettings.brakes.maximumInStepWaitMs;

// The schedule the steps were given: each step's first request at its start, its second one stagger later.
function scheduleOf(run) {
  return run.steps.flatMap((step, index) => {
    const count = (run.steps[index + 1]?.firstRequest ?? run.starts.length) - step.firstRequest;
    return count === 2 ? [step.startedAtMs, step.startedAtMs + step.staggerMs] : [step.startedAtMs];
  });
}

test("two-page steps of a slowed run keep every gap: durable slots, then in-memory waits, every window from 1 s to 10 min", async () => {
  const run = await buybackRun({ factor: 120 });
  const pendingSeen = [];
  while (run.starts.length < 19) {
    const job = await run.tick();
    assert.equal(job.status, "running", JSON.stringify(plain(job.failure ?? null)));
    if (job.pendingStep) {
      // Between slots: the first page's answer is kept as a checksummed pending page, apart from the canonical pages.
      const kept = await run.repository.getPage(run.pendingKey);
      assert.equal(kept.pending, true);
      assert.equal(kept.sha256.length, 64);
      assert.deepEqual([job.pendingStep.phase, job.pendingStep.requestsStarted, job.pendingStep.requestsFinished], ["second-lane", 1, 1]);
      assert.equal(Date.parse(job.pendingStep.nextRequestAt), run.starts.at(-1) + job.pendingStep.logicalStaggerMs);
      assert.equal(job.nextEligibleAt, job.pendingStep.nextRequestAt);
      pendingSeen.push(job.pendingStep.logicalStaggerMs);
    } else {
      assert.equal(await run.repository.getPage(run.pendingKey) ?? null, null, "a completed step consumes its pending page");
    }
  }
  // The slowed steps waited in durable slots; once the run sped up, the gap was waited in memory, as before.
  assert.ok(pendingSeen.length >= 2, `${pendingSeen.length} durable slots`);
  assert.ok(pendingSeen.every((staggerMs) => staggerMs > IN_STEP_WAIT_MS));
  assert.ok(run.steps.some((step) => step.staggerMs <= IN_STEP_WAIT_MS && step.staggerMs > 0), "a later step waited in memory");
  // Each page was asked for once, in order, and each request started exactly at its time.
  assert.deepEqual(run.fetches().map(pageOf), Array.from({ length: run.starts.length }, (_, index) => index + 1));
  const schedule = scheduleOf(run).slice(0, run.starts.length);
  assert.deepEqual(run.starts, schedule);
  for (let index = 1; index < run.steps.length; index += 1) {
    const previous = run.steps[index - 1];
    assert.equal(run.steps[index].startedAtMs, Math.max(previous.startedAtMs + previous.staggerMs + 250, previous.startedAtMs + previous.intervalMs));
  }
  // No window holds more requests than the schedule's, nor more than its smallest gap allows.
  const smallestGapMs = Math.min(...schedule.slice(1).map((startMs, index) => startMs - schedule[index]));
  for (const windowMs of WINDOWS_MS) {
    assert.ok(busiest(run.starts, windowMs) <= busiest(schedule, windowMs), `window ${windowMs} ms`);
    assert.ok(busiest(run.starts, windowMs) <= Math.floor((windowMs - 1) / smallestGapMs) + 1, `window ${windowMs} ms over the smallest gap ${smallestGapMs} ms`);
  }
  // The stored pages hold every page once: no kept answer was stored twice.
  const stored = [...run.repository.inspect().pages.values()].filter((page) => page.pending !== true);
  assert.deepEqual(stored.flatMap((page) => JSON.parse(page.text).raw.map((row) => row.buybackId)).sort((left, right) => left - right), Array.from({ length: run.starts.length }, (_, index) => index + 1));
});

test("a worker restart between slots goes on from the kept answer: the first page is not asked again", async () => {
  const run = await buybackRun({ factor: 120 });
  await run.tick();
  const pending = await run.tick();
  assert.equal(pending.pendingStep.phase, "second-lane");
  run.restart();
  const done = await run.tick();
  assert.equal(done.pendingStep, null);
  assert.deepEqual(run.fetches().map(pageOf), [1, 2, 3], "page 2 was sent once, before the restart");
  assert.equal(run.workers[1].calls.filter((call) => call.kind === "cookie").length, 1, "the restarted worker read the token for page 3 only");
  const step = [...run.repository.inspect().pages.values()].find((page) => page.pending !== true && JSON.parse(page.text).raw.some((row) => row.buybackId === 3));
  assert.deepEqual(JSON.parse(step.text).raw.map((row) => row.buybackId), [2, 3]);
  assert.equal(await run.repository.getPage(run.pendingKey) ?? null, null);
  assert.equal(run.starts[2] - run.starts[1], run.steps[1].staggerMs);
});

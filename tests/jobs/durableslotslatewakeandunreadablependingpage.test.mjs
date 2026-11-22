// Durable request slots that go wrong (PARSER_HARDENING.md §6.3, F19, F20): a late wake sends late, never early; a
// refused slot drops the kept answer and the step is tried again whole; a pending page that cannot be read back is
// dropped and the step starts over, never served altered.
import assert from "node:assert/strict";
import test from "node:test";
import { SECOND, buybackPage, pageOf, buybackRun } from "./durableslotsbuybackrun.mjs";

test("a late wake sends late, never early; a refused slot drops the kept answer and the step is tried again whole", async () => {
  // Late: the watchdog wakes 25 seconds after the slot's time.
  const late = await buybackRun({ factor: 120 });
  await late.tick();
  const pending = await late.tick();
  await late.tick({ wake: (dueMs) => dueMs + 25 * SECOND });
  assert.equal(late.starts[2], Date.parse(pending.pendingStep.nextRequestAt) + 25 * SECOND);
  // Refused: the second slot's page is answered 429.
  const responses = [buybackPage(1, 40), buybackPage(2, 40), { kind: "http-error", status: 429, body: "{}" }, buybackPage(2, 40), buybackPage(3, 40)];
  const refused = await buybackRun({ factor: 120, responses });
  await refused.tick();
  await refused.tick();
  const waiting = await refused.tick();
  assert.deepEqual([waiting.status, waiting.pendingStep, waiting.pace.attempt], ["running", null, 1]);
  assert.equal(await refused.repository.getPage(refused.pendingKey) ?? null, null, "the refused step's kept answer is dropped");
  // The refused request counts. This isolated worker does not load the status-page checker, so it sends no status read.
  assert.deepEqual([waiting.actualRequestsByAllowance.baseline, waiting.actualRequestsByAllowance.statusChecks, waiting.actualRequestCount], [3, 0, 3], "the refused request counts");
  assert.equal(waiting.requestCount, 1, "no step was stored for it");
  assert.equal(waiting.nextEligibleAt, waiting.pace.retryNotBefore);
  // The step is tried again from its start: page 2 is asked again, its kept answer being gone with the refusal.
  await refused.tick();
  const done = await refused.tick();
  assert.equal(done.pendingStep, null);
  assert.deepEqual(refused.fetches().map(pageOf), [1, 2, 3, 2, 3]);
  assert.ok(refused.starts[3] >= Date.parse(waiting.pace.retryNotBefore));
});

test("a pending page that cannot be read back is dropped and the step starts over; it is never served altered", async () => {
  const run = await buybackRun({ factor: 120, responses: [buybackPage(1, 40), buybackPage(2, 40), buybackPage(2, 40), buybackPage(3, 40)] });
  await run.tick();
  await run.tick();
  // The kept answer is altered in storage, as a damaged database would hold it.
  const kept = run.repository.inspect().pages.get(run.pendingKey);
  run.repository.inspect().pages.set(run.pendingKey, { ...kept, text: kept.text.replace("<article", "<altered") });
  const restarted = await run.tick();
  assert.equal(restarted.pendingStep.phase, "second-lane", "the step started over and stopped at its slot again");
  const done = await run.tick();
  assert.equal(done.pendingStep, null);
  assert.deepEqual(run.fetches().map(pageOf), [1, 2, 2, 3]);
  assert.ok(!JSON.stringify([...run.repository.inspect().pages.values()].map((page) => page.text)).includes("altered"));
});

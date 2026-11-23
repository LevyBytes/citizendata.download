// A cancelled image run ends at once wherever it waits: during a request, the gap between two starts, a refusal's
// wait with no request active, a retry's wait, and while a worker waits for an image to take. Nothing starts, is
// retried, or is recorded after it. The waits are controlled promises on a clock that never moves on its own.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NOW, assertCancelledAndStill, cancellable, controlledRun, endWaitsUntil, failing, image, refused, until } from "./mediamaterializercontrolledrun.mjs";

test("cancelled during a request, the run ends without a receipt, and a second cancel changes nothing", async () => {
  const run = controlledRun(1, (_, options) => cancellable(options));
  await until(() => run.fetches.length === 1, "the request did not start");
  run.controller.abort();
  run.controller.abort();
  await assertCancelledAndStill(run);
  assert.equal(run.receipts, 0);
});

test("cancelled in the gap between two starts, the run ends before the gap does and starts nothing more", async () => {
  const run = controlledRun(3, (address) => image(address));
  await until(() => run.waits.some((wait) => wait.phase === "waiting" && wait.reason === "request-spacing"), "no gap between two starts was reported");
  run.controller.abort();
  await assertCancelledAndStill(run);
  assert.equal(run.waits.filter((wait) => wait.phase === "resumed" && wait.reason === "request-spacing").length, 0, "the gap ended although it was cancelled");
});

test("cancelled in a refusal's wait with no request active and three images left, the run ends long before the wait would", async () => {
  const run = controlledRun(3, (address) => refused(address));
  // The gaps before the starts are ended as they come; the refusal's wait is left running.
  await endWaitsUntil(run, () => run.waits.some((wait) => wait.reason === "rate-limit"));
  const wait = run.waits.find((candidate) => candidate.reason === "rate-limit");
  assert.ok(wait, "no refusal's wait was reported");
  assert.deepEqual([wait.phase, wait.waitMs, wait.waitingUntil, wait.pending], ["waiting", 600_000, new Date(NOW + 600_000).toISOString(), 0]);
  assert.equal(run.receipts, 0, "all three images are still to download");
  run.controller.abort();
  await assertCancelledAndStill(run);
});

test("cancelled in the wait before a retry, the image is not asked for again", async () => {
  const run = controlledRun(1, (address) => failing(address));
  await until(() => run.waits.some((wait) => wait.reason === "retry"), "no retry wait was reported");
  const wait = run.waits.find((candidate) => candidate.reason === "retry");
  assert.deepEqual([wait.phase, wait.imageIndex, wait.attempt], ["waiting", 0, 2]);
  run.controller.abort();
  await assertCancelledAndStill(run);
  assert.equal(run.fetches.length, 1);
});

test("a worker waiting for an image to take is woken by the cancellation, even when a request never answers", async () => {
  // The first image's request ignores the cancellation and never answers; the second image downloads, and its
  // worker then waits for work that will not come. The run still ends at once.
  const run = controlledRun(2, (address, _, number) => (number === 1 ? new Promise(() => {}) : image(address)));
  await endWaitsUntil(run, () => run.receipts >= 1);
  assert.equal(run.receipts, 1, "the second image did not download");
  run.controller.abort();
  await assertCancelledAndStill(run);
});

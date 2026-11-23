// An image run whose every wait is a sleep only the test ends, on a clock that stands still, for the tests of
// cancellation during the run's waits.
import assert from "node:assert/strict";
import { load, png, policy } from "./media-materializer-in-a-sandbox.mjs";

export const NOW = 1_000_000;
const url = (index) => `https://media.robertsspaceindustries.com/${index}.png`;
const entries = (count) => Array.from({ length: count }, (_, index) => ({ normalizedUrl: url(index), imageKey: String(index + 1).repeat(64), title: `Image ${index}`, references: [{ recordType: "pledge", recordKey: `p${index}`, role: "thumbnail" }] }));
const headers = (values) => ({ get: (name) => values[name.toLowerCase()] ?? null });
export const image = (address) => ({ status: 200, url: address, headers: headers({ "content-type": "image/png" }), arrayBuffer: async () => png().buffer.slice(0) });
export const refused = (address) => ({ status: 429, url: address, headers: headers({ "retry-after": "600" }), arrayBuffer: async () => new ArrayBuffer(0) });
export const failing = (address) => ({ status: 500, url: address, headers: headers({}), arrayBuffer: async () => new ArrayBuffer(0) });
export const cancellable = (options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError"))));
export const turn = () => new Promise((resolve) => setImmediate(resolve));

export async function until(predicate, what) {
  for (let round = 0; round < 400 && !predicate(); round += 1) await turn();
  assert.ok(predicate(), what);
}

// Ends every wait the run is in, round after round, until `predicate` holds.
export async function endWaitsUntil(run, predicate) {
  for (let round = 0; round < 200 && !predicate(); round += 1) {
    for (const sleep of run.sleeps.splice(0)) sleep.resolve();
    await turn();
  }
}

export function controlledRun(count, answer) {
  const controller = new AbortController();
  const run = { controller, sleeps: [], waits: [], fetches: [], pending: 0, receipts: 0, settled: null };
  const fetcher = (address, options) => {
    run.fetches.push(address);
    run.pending += 1;
    return Promise.resolve(answer(address, options, run.fetches.length)).finally(() => { run.pending -= 1; });
  };
  run.outcome = load().materialize(entries(count), policy, {
    fetcher, signal: controller.signal, random: () => 0.5, nowMs: () => NOW, now: () => new Date(NOW).toISOString(),
    sleep: (milliseconds) => new Promise((resolve) => run.sleeps.push({ milliseconds, resolve })),
    onWait: (wait) => run.waits.push({ phase: wait.phase, reason: wait.reason, waitMs: wait.waitMs, waitingUntil: wait.waitingUntil, imageIndex: wait.imageIndex, attempt: wait.attempt, pending: run.pending }),
    onProgress: ({ receipt }) => { if (receipt) run.receipts += 1; }
  }).then(() => "finished", (error) => error.name);
  void run.outcome.then((value) => { run.settled = value; });
  return run;
}

// After the cancellation: the run ended as cancelled, and when every wait it left is ended, nothing more happens.
export async function assertCancelledAndStill(run) {
  const fetches = run.fetches.length;
  const waits = run.waits.length;
  const receipts = run.receipts;
  await until(() => run.settled !== null, "the cancelled run did not end");
  assert.equal(run.settled, "AbortError");
  for (let round = 0; round < 6; round += 1) {
    for (const sleep of run.sleeps.splice(0)) sleep.resolve();
    await turn();
  }
  assert.equal(run.fetches.length, fetches, "a request started after the cancellation");
  assert.equal(run.waits.length, waits, "a wait began or ended after the cancellation");
  assert.equal(run.receipts, receipts, "an image was recorded after the cancellation");
}

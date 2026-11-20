import assert from "node:assert/strict";
import { test } from "node:test";
import { load, policy } from "./media-materializer-in-a-sandbox.mjs";

test("a download cancelled while requests wait their turn starts none of them", async () => {
  const api = load();
  const entries = Array.from({ length: 4 }, (_, index) => ({
    normalizedUrl: `https://media.robertsspaceindustries.com/${index}.png`,
    imageKey: String(index + 1).repeat(64),
    title: String(index),
    references: [{ recordType: "pledge", recordKey: `p${index}`, role: "thumbnail" }]
  }));
  const controller = new AbortController();
  const started = [];
  const waiting = [];
  const outcome = api.materialize(entries, policy, {
    signal: controller.signal,
    random: () => 0.5,
    // A request waiting for its turn waits until the test lets it go.
    sleep: () => new Promise((resolve) => waiting.push(resolve)),
    fetcher: (url, options) => {
      started.push(url);
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError"))));
    }
  }).then(() => "finished", (error) => error.name);
  while (started.length < 1 || waiting.length < 1) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.equal(await outcome, "AbortError");
  // The requests that were waiting are released after the cancel, and none of them is sent.
  for (let round = 0; round < 8; round += 1) {
    for (const release of waiting.splice(0)) release();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(started, [entries[0].normalizedUrl]);
});

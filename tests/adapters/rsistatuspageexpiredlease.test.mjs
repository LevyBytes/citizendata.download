// A pending status-feed lease never revives an expired cached answer while its holder is unavailable.
import assert from "node:assert/strict";
import test from "node:test";
import { world } from "./rsi-status-page-durable-lease-across-workers.test.mjs";

test("a pending lease with only an expired cache result is unreadable, not stale", async () => {
  const { repository, clock, requests, worker } = world();
  const old = new Date(clock.now - 600_000).toISOString();
  await repository.putStatusFeedCache({
    status: "issue", reason: null, components: [{ name: "Old incident", state: "disrupted" }], httpStatus: 200,
    requestedAt: old, checkedAt: old, expiresAt: new Date(clock.now - 1).toISOString()
  });
  void worker({ answer: "hang" }).check();
  await new Promise((resolve) => setImmediate(resolve));
  const waiting = await worker().check();
  assert.deepEqual(JSON.parse(JSON.stringify([waiting.status, waiting.reason, waiting.components, requests.length])), ["unknown", "unreadable", [], 1]);
});

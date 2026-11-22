// The image run's refusals and give-up (PARSER_HARDENING.md §14, F12), on the virtual clock: before any image
// downloads the third TypeError is a refusal; after 30 minutes with no image the rest is recorded RATE_LIMITED; a
// visible 429 is a refusal, and a redirect twice fails its image.
import assert from "node:assert/strict";
import test from "node:test";
import { imageHost, load, policy, virtualTime } from "./media-materializer-in-a-sandbox.mjs";
import { plain, url, entries, images, heldLimit } from "./mediamaterializerbrakesrun.mjs";

test("before any image downloads, the third TypeError is a refusal, and each after it until an image downloads", async () => {
  const time = virtualTime();
  const limiter = heldLimit(time, { from: 1, durationMs: 30_000 });
  const host = imageHost({ time, images: images(1), limiters: [limiter] });
  const progress = [];
  const result = plain(await load().materialize(entries(1), policy, { fetcher: host.fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5, onProgress: (value) => progress.push(plain(value)) }));
  assert.equal(result.assets[0].status, "downloaded");
  assert.ok(result.refusedAttempts >= 1);
  // The first two were retried as today, with no wait: the first refusal came with the third request.
  const firstWarning = progress.findIndex((value) => value.pace.warning === "limited");
  assert.ok(firstWarning >= 0);
  assert.equal(host.requests.filter((request) => request.cache !== "no-store").length > 3, true);
  assert.equal(host.requests.filter((request) => request.cache === "no-store").length, 0, "with no image downloaded there is no control image");
});

test("after 30 minutes with no image downloaded the run stops, the rest recorded RATE_LIMITED", async () => {
  const time = virtualTime();
  const always = { answer: () => ({ status: 429 }) };
  const host = imageHost({ time, images: images(8), limiters: [always] });
  const startedAt = time.nowMs();
  const result = plain(await load().materialize(entries(8), policy, { fetcher: host.fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5 }));
  assert.equal(result.stoppedWithRemaining, true);
  assert.ok(result.assets.every((asset) => asset.status === "failed" && asset.errorCode === "RATE_LIMITED"), JSON.stringify(result.assets.map((asset) => asset.errorCode)));
  assert.ok(time.nowMs() - startedAt >= 30 * 60_000, `stopped after ${time.nowMs() - startedAt} ms`);
  assert.ok(result.actualRequests === host.requests.length);
});

test("a visible 429 is a refusal; a redirect is not, and the second for the same image fails it", async () => {
  const time = virtualTime();
  const limiter = heldLimit(time, { from: 2, durationMs: 20_000 });
  const visible = await (async () => {
    const host = imageHost({ time, images: images(3), limiters: [limiter], corsHidden: false });
    return plain(await load().materialize(entries(3), policy, { fetcher: host.fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5 }));
  })();
  assert.ok(visible.assets.every((asset) => asset.status === "downloaded"));
  assert.ok(visible.refusedAttempts >= 1);
  const later = virtualTime();
  const host = imageHost({ time: later, images: images(2) });
  const redirecting = async (address, options) => address === url(1) ? { status: 0, url: "", headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) } : host.fetcher(address, options);
  const redirected = plain(await load().materialize(entries(2), policy, { fetcher: redirecting, sleep: later.sleep, nowMs: later.nowMs, now: later.now, random: () => 0.5 }));
  assert.deepEqual(redirected.assets.map((asset) => [asset.status, asset.errorCode, asset.attempts]), [["downloaded", null, 1], ["failed", "HTTP_0", 2]]);
  assert.equal(redirected.refusedAttempts, 0);
});

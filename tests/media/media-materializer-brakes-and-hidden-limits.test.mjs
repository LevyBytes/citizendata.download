// The image run's brakes (PARSER_HARDENING.md §14, F12), on the virtual clock: it starts at factor 2; a missing
// image is told from a refusal by the control image; a CORS-hidden 429 brakes the run and it completes once the
// limit lifts.
import assert from "node:assert/strict";
import test from "node:test";
import { imageHost, load, pacing, png, policy, virtualTime } from "./media-materializer-in-a-sandbox.mjs";
import { plain, url, entries, images, heldLimit, run } from "./mediamaterializerbrakesrun.mjs";

test("the image run starts at factor 2: starts 300 ms apart at the middle of 200 to 400 ms, four in flight at most", async () => {
  const { host, progress, result } = await run(6);
  const starts = host.requests.map((request) => request.at);
  assert.deepEqual(starts.slice(1).map((at, index) => at - starts[index]), [300, 300, 300, 300, 300]);
  assert.equal(progress[0].pace.factor <= 2, true);
  assert.ok(result.assets.every((asset) => asset.status === "downloaded"));
  assert.equal(result.stoppedWithRemaining, false);
});

test("a missing image is told from a refusal by the control image: three attempts, then failed, and the pace unbraked", async () => {
  const { host, progress, result } = await run(2, { missing: [url(1)] });
  assert.deepEqual(result.assets.map((asset) => [asset.status, asset.attempts]), [["downloaded", 1], ["failed", 3]]);
  // One control request served the image's three failures: the last image that downloaded, asked again without the cache.
  const controls = host.requests.filter((request) => request.cache === "no-store");
  assert.deepEqual(controls.map((request) => request.url), [url(0)]);
  assert.equal(result.refusedAttempts, 0);
  assert.ok(progress.every((value) => value.pace.warning === null), "a dead link does not brake the run");
});

test("under a CORS-hidden 429 the run brakes, starts nothing before the wait ends, and completes once the limit lifts", async () => {
  const time = virtualTime();
  const limiter = heldLimit(time, { from: 4, durationMs: 60_000 });
  const host = imageHost({ time, images: images(8), limiters: [limiter] });
  const progress = [];
  const result = plain(await load().materialize(entries(8), policy, { fetcher: host.fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5, onProgress: (value) => progress.push({ at: time.nowMs(), ...plain(value) }) }));
  assert.ok(result.assets.every((asset) => asset.status === "downloaded"), JSON.stringify(result.assets.map((asset) => asset.errorCode)));
  assert.ok(result.refusedAttempts > 0);
  assert.ok(progress.some((value) => value.pace.warning === "limited" && value.pace.waitingUntil !== null));
  // No request started while a wait the run reported was ahead.
  for (const value of progress.filter((entry) => entry.pace.waitingUntil)) {
    const until = Date.parse(value.pace.waitingUntil);
    assert.ok(!host.requests.some((request) => request.at > value.at && request.at < until), `a request started before ${value.pace.waitingUntil}`);
  }
  // A refused attempt is not one of an image's three attempts.
  assert.ok(result.assets.every((asset) => asset.attempts <= 3));
});

test("four refusals already in flight record four answers but slow the controller once", async () => {
  const time = virtualTime();
  const base = pacing().controller;
  let transitions = 0;
  const controller = { ...base, onRefusal(...input) { transitions += 1; return base.onRefusal(...input); } };
  let firstWave = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const fetcher = async (address) => {
    if (firstWave < 4) {
      firstWave += 1;
      if (firstWave === 4) release();
      await barrier;
      return { status: 429, url: address, headers: { get: (name) => name === "retry-after" ? "7" : null } };
    }
    const bytes = png();
    return { status: 200, url: address, headers: { get: () => "image/png" }, arrayBuffer: async () => bytes.buffer };
  };
  const result = plain(await load().materialize(entries(4), policy, {
    fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5, paceController: controller
  }));
  assert.equal(result.refusedAttempts, 4, "every refused answer remains evidence");
  assert.equal(transitions, 1, "one concurrent batch changes the controller once");
  assert.equal(result.pacing.refusedRequests, 4);
  assert.equal(result.pacing.maximumFactor, 4, "factor 2 doubles once, not four times");
  assert.ok(result.assets.every((asset) => asset.status === "downloaded"));
});

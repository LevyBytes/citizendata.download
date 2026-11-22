// The image run's pace in order (PARSER_HARDENING.md §4.7, §14): a completion that ends after a refusal cannot
// replace the newer wait or warning; the latest wait gates every queued start; the actual requests, control
// requests among them, stay within the bound and are counted; every progress value carries bounded pace; the
// result carries stoppedWithRemaining.
import assert from "node:assert/strict";
import test from "node:test";
import { imageHost, load, policy, virtualTime } from "./media-materializer-in-a-sandbox.mjs";
import { plain, url, entry, imagesFor } from "./mediamaterializerimageentries.mjs";

test("a completion that ends after a refusal keeps the newer wait and warning, and no queued start passes the wait", async () => {
  const time = virtualTime();
  const host = imageHost({ time, images: imagesFor(4), corsHidden: false });
  // Image 0 answers slowly and well, inside the wait; image 1 answers 429 while image 0 is still on its way. Each
  // request's start is recorded when it is sent.
  const starts = [];
  const fetcher = async (address, options) => {
    starts.push({ url: address, at: time.nowMs() });
    if (address === url(0)) {
      await time.sleep(2_000);
      return host.fetcher(address, options);
    }
    if (address === url(1) && starts.filter((start) => start.url === url(1)).length === 1) {
      await time.sleep(40);
      return { status: 429, url: address, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return host.fetcher(address, options);
  };
  const progress = [];
  const result = plain(await load().materialize([0, 1, 2, 3].map(entry), policy, { fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5, onProgress: (value) => progress.push({ at: time.nowMs(), ...plain(value) }) }));
  assert.ok(result.assets.every((asset) => asset.status === "downloaded"));
  const refusal = progress.find((value) => value.pace.warning === "limited");
  const completion = progress.find((value) => value.receipt?.sourceUrl === url(0));
  assert.ok(refusal && completion && completion.at > refusal.at, "image 0 ended after the refusal");
  assert.deepEqual([completion.pace.warning, completion.pace.waitingUntil], ["limited", refusal.pace.waitingUntil], "the older completion kept the newer wait");
  const until = Date.parse(refusal.pace.waitingUntil);
  assert.ok(!starts.some((start) => start.at > refusal.at && start.at < until), "a start passed the wait");
});

test("actual requests, control requests among them, are counted and stay within the bound", async () => {
  const time = virtualTime();
  const images = imagesFor(3);
  images.delete(url(2));
  const host = imageHost({ time, images });
  const result = plain(await load().materialize([0, 1, 2].map(entry), policy, { fetcher: host.fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5 }));
  assert.equal(result.actualRequests, host.requests.length);
  assert.ok(host.requests.some((request) => request.cache === "no-store"), "the control request is among them");
  assert.ok(result.actualRequests <= 3 * (policy.maximumAttempts + 8 + 1));
});

test("every progress value carries the bounded pace and the status the page supplies; the result says whether images remain", async () => {
  const time = virtualTime();
  const host = imageHost({ time, images: imagesFor(3) });
  const statusPage = { status: "ok", reason: null, components: [], checkedAt: "2026-11-21T00:00:00.000Z" };
  const progress = [];
  const result = plain(await load().materialize([0, 1, 2].map(entry), policy, { fetcher: host.fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5, statusPage: () => statusPage,
    onProgress: (value) => progress.push(plain(value)) }));
  assert.ok(progress.length >= 3);
  for (const value of progress) {
    assert.deepEqual(Object.keys(value.pace).sort(), ["factor", "statusPage", "waitingUntil", "warning"]);
    assert.ok([null, "limited", "slow"].includes(value.pace.warning));
    assert.ok(Number.isFinite(value.pace.factor) && value.pace.factor >= 1);
    assert.deepEqual(value.pace.statusPage, statusPage);
  }
  assert.equal(result.stoppedWithRemaining, false);
  assert.match(result.pacing.settingsFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(result.pacing.startedFactor, 2);
  assert.equal(result.pacing.acceptedRequests, 3);
});

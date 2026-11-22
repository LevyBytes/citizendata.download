import assert from "node:assert/strict";
import { test } from "node:test";
import { load, pacing, png, policy } from "./media-materializer-in-a-sandbox.mjs";

test("materializer spaces concurrent starts, omits credentials, validates magic, and keeps content-addressed paths", async () => {
  const api = load();
  const calls = [];
  const delays = [];
  const entries = [
    { normalizedUrl: "https://media.robertsspaceindustries.com/a.png", imageKey: "a".repeat(64), sourceImageKeys: ["1".repeat(64)], title: "A", references: [{ recordType: "pledge", recordKey: "p1", role: "thumbnail" }] },
    { normalizedUrl: "https://media.robertsspaceindustries.com/b.png", imageKey: "b".repeat(64), sourceImageKeys: ["2".repeat(64)], title: "B", references: [{ recordType: "pledge", recordKey: "p2", role: "thumbnail" }] }
  ];
  const result = await api.materialize(entries, policy, {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      const bytes = png();
      return { status: 200, url, headers: { get: () => "image/png; charset=binary" }, arrayBuffer: async () => bytes.buffer };
    },
    sleep: async (delay) => delays.push(delay),
    // Today's schedule, from the 1x pace; the image run itself starts slower (§14, §15.3).
    initialPace: pacing().atBaseline(),
    random: () => 0.5,
    now: () => "2026-11-17T00:00:00.000Z"
  });
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.options.credentials === "omit" && call.options.redirect === "manual" && call.options.referrerPolicy === "no-referrer"), true);
  assert.deepEqual(delays, [150]);
  assert.equal(result.assets.every((asset) => asset.status === "downloaded" && asset.pixelWidth === 2 && asset.pixelHeight === 3), true);
  assert.equal(result.files.every((file) => /^media\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/u.test(file.name)), true);
});

test("materializer permits four fetches in flight while retaining plan order", async () => {
  const api = load();
  const entries = Array.from({ length: 4 }, (_, index) => ({
    normalizedUrl: `https://media.robertsspaceindustries.com/${index}.png`,
    imageKey: String(index + 1).repeat(64),
    title: String(index),
    references: [{ recordType: "pledge", recordKey: `p${index}`, role: "thumbnail" }]
  }));
  let inFlight = 0;
  let maximumInFlight = 0;
  let started = 0;
  const reportedActive = [];
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const result = await api.materialize(entries, policy, {
    sleep: async () => {},
    random: () => 0.5,
    onRequestStart: ({ activeRequests, maximumConcurrency }) => reportedActive.push({ activeRequests, maximumConcurrency }),
    fetcher: async (url) => {
      inFlight += 1;
      started += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      if (started === 4) release();
      await barrier;
      inFlight -= 1;
      const bytes = png();
      return { status: 200, url, headers: { get: () => "image/png" }, arrayBuffer: async () => bytes.buffer };
    }
  });
  assert.equal(maximumInFlight, 4);
  assert.equal(Math.max(...reportedActive.map(entry => entry.activeRequests)), 4);
  assert.equal(reportedActive.every(entry => entry.maximumConcurrency === 4), true);
  assert.deepEqual(Array.from(result.assets, asset => asset.assetId), entries.map(entry => entry.imageKey));
});

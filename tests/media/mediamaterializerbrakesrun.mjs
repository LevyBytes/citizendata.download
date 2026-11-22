// An image run on the virtual clock against a stand-in image host, for the tests of the image run's brakes.
import { imageHost, load, png, policy, virtualTime } from "./media-materializer-in-a-sandbox.mjs";

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const url = (index) => `https://media.robertsspaceindustries.com/${index}.png`;

export function entries(count) {
  return Array.from({ length: count }, (_, index) => ({ normalizedUrl: url(index), imageKey: String(index % 10).repeat(64).slice(0, 63) + String(index % 10), sourceImageKeys: [], title: `Image ${index}`, references: [{ recordType: "pledge",
    recordKey: `p${index}`, role: "thumbnail" }] }));
}

export function images(count, missing = []) {
  return new Map(Array.from({ length: count }, (_, index) => [url(index), png(2 + index, 3)]).filter(([address]) => !missing.includes(address)));
}

// Refuses every request from the `from`th one for `durationMs`, as a limit RSI holds for a while.
export function heldLimit(time, { from, durationMs }) {
  let count = 0;
  let until = -Infinity;
  return { answer() { count += 1; if (count === from) until = time.nowMs() + durationMs; return time.nowMs() < until ? { status: 429 } : null; } };
}

export async function run(count, { limiters = [], corsHidden = true, missing = [], fetcher = null } = {}) {
  const time = virtualTime();
  const host = imageHost({ time, images: images(count, missing), limiters, corsHidden });
  const progress = [];
  const startedAt = time.nowMs();
  const result = await load().materialize(entries(count), policy, { fetcher: fetcher ?? host.fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5, onProgress: (value) => progress.push({ at: time.nowMs(), ...plain(value) }) });
  return { time, host, progress, result: plain(result), elapsedMs: time.nowMs() - startedAt };
}

// RSI's status feed is asked at most once per cache period across workers, restarts and concurrent callers (§9.3,
// criterion 25). Each checker below stands for one worker, all on one repository: the lease is taken in one
// transaction before any fetch; a worker ended after taking it, or after its answer came, causes no second request in
// that period; its lease lapses after one period and the next caller reads again; and a late result never replaces a
// record from a read reserved after it.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { database } from "../jobs/database-under-test.mjs";
import { STATUS_FEED_VARIANTS } from "../support/synthetic-rsi/status-feed-answers.mjs";
import { root } from "./repository-root.mjs";

const context = await loadClassicScripts([
  path.join(root, "extension", "shared", "request-pacing-settings.js"),
  path.join(root, "extension", "adapters", "rsi-status-page.js")
], { AbortController, setTimeout, clearTimeout, TextEncoder, crypto: globalThis.crypto });
const StatusPage = context.CitizenDataRsiStatusPage;
const CACHE_MS = 300_000;
const plain = (value) => JSON.parse(JSON.stringify(value));

// One repository, one clock, and the requests every worker sent. `worker({ answer })` makes a worker's checker:
// "ok" answers at once, "hang" never answers (the worker was ended mid-read), "late" answers when `release` is called.
export function world() {
  const repository = database.createMemoryRepository();
  const clock = { now: Date.parse("2026-11-21T12:00:00Z") };
  const requests = [];
  const cache = { get: () => repository.getStatusFeedCache(), put: (record, leaseId) => repository.putStatusFeedCache(record, leaseId), reserve: (input) => repository.reserveStatusFeedRead(input) };
  function worker({ answer = "ok", ended = false } = {}) {
    let release = null;
    const fetcher = async () => {
      requests.push(clock.now);
      if (answer === "hang") return new Promise(() => {});
      if (answer === "late") await new Promise((resolve) => { release = resolve; });
      const feed = STATUS_FEED_VARIANTS.ok();
      return { status: feed.status, headers: { get: () => feed.contentType }, text: async () => feed.body };
    };
    // A worker ended after its answer came never stores it.
    const stored = ended ? { ...cache, put: () => new Promise(() => {}) } : cache;
    const checker = StatusPage.createChecker({ fetcher, hasPermission: async () => true, cache: stored, nowMs: () => clock.now, wait: async (milliseconds) => { clock.now += milliseconds; } });
    return { check: () => checker.checkStatusPage(), release: () => release?.() };
  }
  return { repository, clock, requests, worker };
}

test("two workers asking at once send one request and get the same result", async () => {
  const { clock, requests, worker } = world();
  const [first, second] = await Promise.all([worker().check(), worker().check()]);
  assert.equal(requests.length, 1);
  assert.deepEqual(plain(first), plain(second));
  assert.equal(first.status, "ok");
  clock.now = Date.parse(first.checkedAt) + CACHE_MS - 1;
  await worker().check();
  assert.equal(requests.length, 1, "the cache period still holds");
});

for (const [when, options] of [["after taking the lease", { answer: "hang" }], ["after its answer came", { ended: true }]]) {
  test(`a worker ended ${when} causes no second request in the cache period; its lease lapses after it`, async () => {
    const { repository, clock, requests, worker } = world();
    void worker(options).check();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 1);
    const startedAt = clock.now;
    // The next worker finds the lease, sends nothing, and, with no result stored, counts the feed as not read.
    const waiting = await worker().check();
    assert.deepEqual([waiting.status, waiting.reason, requests.length], ["unknown", "unreadable", 1]);
    clock.now = startedAt + CACHE_MS - 1;
    await worker().check();
    assert.equal(requests.length, 1, "no second request inside the period");
    // After one period the lease has lapsed: the next caller reads again, stores the result, and releases the lease.
    clock.now = startedAt + CACHE_MS;
    const recovered = await worker().check();
    assert.deepEqual([recovered.status, requests.length], ["ok", 2]);
    assert.equal(plain(await repository.getStatusFeedCache()).checkedAt, new Date(clock.now).toISOString());
    assert.deepEqual(plain(await repository.reserveStatusFeedRead({ nowMs: clock.now, leaseMs: CACHE_MS, leaseId: "probe" })).action, "cached");
  });
}

test("a lease stored longer than one period is not honoured", async () => {
  const { repository, clock, requests, worker } = world();
  await repository.reserveStatusFeedRead({ nowMs: clock.now + 10 * CACHE_MS, leaseMs: CACHE_MS, leaseId: "future" });
  assert.equal((await worker().check()).status, "ok");
  assert.equal(requests.length, 1);
});

test("a late result from a lapsed lease does not replace the record of a later read", async () => {
  const { repository, clock, requests, worker } = world();
  const late = worker({ answer: "late" });
  const lateResult = late.check();
  await new Promise((resolve) => setImmediate(resolve));
  clock.now += CACHE_MS;
  assert.equal((await worker().check()).status, "ok");
  const newer = plain(await repository.getStatusFeedCache());
  clock.now += 1000;
  late.release();
  const shown = await lateResult;
  assert.equal(requests.length, 2);
  assert.deepEqual(plain(await repository.getStatusFeedCache()), newer, "the later read's record stays");
  assert.equal(shown.checkedAt, newer.checkedAt, "the late caller is shown the stored, newer record");
});

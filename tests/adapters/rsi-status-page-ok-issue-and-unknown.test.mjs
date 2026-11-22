// RSI's status page (PARSER_HARDENING.md §9.3): the feed recorded on 2026-11-21 is "ok"; a system that is not
// operational, an unresolved issue, or a summary no system explains is "issue" with at least one component; every other
// answer is "unknown" and never "ok". Without the optional permission no request is sent. One request at a time, without
// cookies, to the one address; the durable cache is read first.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { STATUS_FEED_VARIANTS } from "../support/synthetic-rsi/status-feed-answers.mjs";
import { root } from "./repository-root.mjs";

const context = await loadClassicScripts([
  path.join(root, "extension", "shared", "request-pacing-settings.js"),
  path.join(root, "extension", "adapters", "rsi-status-page.js")
], { AbortController, setTimeout, clearTimeout, TextEncoder });
const StatusPage = context.CitizenDataRsiStatusPage;
const plain = (value) => JSON.parse(JSON.stringify(value));

// A stand-in for fetch that answers with a named variant of the status host, and records each request.
function host(variant) {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    if (variant === "network") throw new TypeError("Failed to fetch");
    const answer = STATUS_FEED_VARIANTS[variant]();
    return { status: answer.status, headers: { get: (name) => (name.toLowerCase() === "content-type" ? answer.contentType : null) }, text: async () => answer.body };
  };
  return { requests, fetcher };
}

// A cache like the repository's: a record kept only when it is newer.
function memoryCache() {
  let stored = null;
  return {
    get: async () => stored,
    put: async (record) => {
      if (!stored || Date.parse(record.checkedAt) > Date.parse(stored.checkedAt)) stored = record;
      return stored;
    }
  };
}

async function check(variant, { permission = true, clock = { now: Date.parse("2026-11-21T12:00:00Z") } } = {}) {
  const { requests, fetcher } = host(variant);
  const checker = StatusPage.createChecker({ fetcher, hasPermission: async () => permission, cache: memoryCache(), nowMs: () => clock.now });
  return { result: plain(await checker.checkStatusPage()), requests };
}

test("the recorded feed is ok, read once without cookies from the settings' one address", async () => {
  const { result, requests } = await check("ok");
  assert.deepEqual([result.status, result.reason, result.components, result.httpStatus], ["ok", null, [], 200]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://status.robertsspaceindustries.com/index.json");
  assert.deepEqual([requests[0].init.method, requests[0].init.credentials, requests[0].init.cache, requests[0].init.referrerPolicy], ["GET", "omit", "no-store", "no-referrer"]);
  assert.equal(StatusPage.STATUS_ORIGIN_PATTERN, "https://status.robertsspaceindustries.com/*");
});

test("an issue always names at least one component: a disrupted system, an unresolved issue, or the summary alone", async () => {
  assert.deepEqual((await check("issue-system")).result.components, [{ name: "Platform", state: "disrupted" }]);
  assert.deepEqual((await check("issue-unresolved")).result.components, [{ name: "Persistent Universe", state: "unresolved issue" }]);
  assert.deepEqual((await check("issue-summary-only")).result.components, [{ name: "RSI status", state: "down" }]);
  for (const variant of ["issue-system", "issue-unresolved", "issue-summary-only"]) assert.equal((await check(variant)).result.status, "issue");
});

test("every other answer is unknown and unreadable, never ok; without the permission nothing is sent", async () => {
  for (const variant of ["unreadable-status", "unreadable-html", "unreadable-no-systems", "network"]) {
    const { result } = await check(variant);
    assert.deepEqual([result.status, result.reason], ["unknown", "unreadable"], variant);
  }
  const without = await check("ok", { permission: false });
  assert.deepEqual([without.result.status, without.result.reason, without.requests.length], ["unknown", "no-permission", 0]);
});

test("components are bounded: ten at most, names of 60 printable characters and states of 20, each system once", () => {
  const systems = Array.from({ length: 14 }, (_, index) => ({ name: `System\u0007 ${index} ${"n".repeat(80)}`, category: "x", status: `degraded-${"s".repeat(30)}`, unresolvedIssues: [] }));
  const read = StatusPage.readFeed({ summaryStatus: "disrupted", systems: [...systems, systems[0]] });
  assert.equal(read.components.length, 10);
  assert.ok(read.components.every((component) => component.name.length <= 60 && component.state.length <= 20 && ![...component.name].some((character) => character < " ")));
  assert.equal(new Set(read.components.map((component) => component.name)).size, 10);
  // A shape this module does not know is not read at all.
  for (const feed of [null, [], { summaryStatus: "operational", systems: [] }, { summaryStatus: "operational", systems: [{ name: "Platform", status: "operational" }] }]) assert.equal(StatusPage.readFeed(feed), null);
});

test("the cache is read first: a second check within the cache period sends nothing, a later one reads again", async () => {
  const clock = { now: Date.parse("2026-11-21T12:00:00Z") };
  const { requests, fetcher } = host("ok");
  const checker = StatusPage.createChecker({ fetcher, hasPermission: async () => true, cache: memoryCache(), nowMs: () => clock.now });
  const [first, second] = await Promise.all([checker.checkStatusPage(), checker.checkStatusPage()]);
  assert.equal(requests.length, 1, "concurrent callers share one request");
  assert.deepEqual(plain(first), plain(second));
  clock.now += 299_000;
  await checker.checkStatusPage();
  assert.equal(requests.length, 1);
  clock.now += 2_000;
  await checker.checkStatusPage();
  assert.equal(requests.length, 2);
});

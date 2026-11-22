// Throttled and banned builds through the whole worker (PARSER_HARDENING.md §6, §8, §9, §12.2, §12.3, R1): a build RSI
// throttles brakes and finishes with the document an unthrottled build gives, apart from times and run receipts. A
// build RSI bans gives up for the time being, and its smart check tells the connection from the account: under a ban
// keyed on the connection the request without cookies is refused too (W-3); under one keyed on the account it is
// answered (W-4). Continue is refused, with no request to RSI, until the cool-down ends; Continue after the ban gives
// the same document.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";

const HOUR = 3_600_000;
const plain = (value) => JSON.parse(JSON.stringify(value));

// The document without what differs between two builds of the same account: times, the run receipts, the content
// hash over them, and the local account id, which each new installation draws.
function comparable(document) {
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/At$/u.test(key)).map(([key, item]) => [key, strip(item)]));
  };
  const { integrity: _integrity, sync: { runs: _runs, ...sync } = {}, account: { localAccountId: _localAccountId, ...account } = {}, ...rest } = document;
  return strip({ ...rest, account, sync });
}

async function build(limit = null) {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const limiter = limit ? limit(harness.rsi) : null;
  assert.equal((await tab.build()).code, "RUN_STARTED");
  const final = await harness.finishJob(4 * HOUR);
  return { harness, tab, limiter, final, document: tab.events.findLast((event) => event.result)?.result ?? null };
}

const unthrottled = await build();

test("a build RSI throttles brakes and finishes with the document of an unthrottled build", async () => {
  assert.equal(unthrottled.final.status, "complete");
  const throttled = await build((rsi) => rsi.throttle({ limit: 20, windowMs: 60_000 }));
  assert.equal(throttled.final.status, "complete");
  assert.ok(throttled.harness.rsi.requests.some((request) => request.limited), "RSI refused some of its requests");
  assert.deepEqual(comparable(throttled.document), comparable(unthrottled.document));
});

for (const [key, probe, text] of [["connection", "refused", "W-3"], ["account", "answered", "W-4"]]) {
  test(`a ban keyed on the ${key} gives up with probe "${probe}" (${text}); Continue waits for the cool-down and then finishes the same document`, async () => {
    const banned = await build((rsi) => rsi.ban({ trigger: { limit: 30, windowMs: 60_000 }, durationMs: 2 * HOUR, key }));
    const { harness, tab, limiter } = banned;
    assert.equal(banned.final.status, "failed");
    const job = plain(await harness.repository.getJob(banned.final.lastTerminalJobId));
    assert.equal(job.failure.code, "RSI_RATE_LIMITED");
    const diagnosis = job.failure.detail.diagnosis;
    assert.deepEqual([diagnosis.probe, diagnosis.status, diagnosis.reason], [probe, "ok", null]);
    const lines = job.activityLog.filter((line) => line.kind === "smart-check" && line.check === "public-page");
    assert.deepEqual(lines.map((line) => line.outcome), [probe]);
    // The request without cookies went to the account's own public dossier and carried no cookie.
    const probes = harness.rsi.requests.filter((request) => request.credentialsOmitted && request.origin === "https://robertsspaceindustries.com");
    assert.deepEqual(probes.map((request) => request.path), [`/en/citizens/${job.accountId}`]);
    // The public status shows the bounded failure, the cool-down, and that the build can be continued.
    const status = (await tab.request("GET_STATUS")).status;
    assert.deepEqual([status.activeJob.failure.code, status.activeJob.failure.detail.diagnosis.probe, status.continuable], ["RSI_RATE_LIMITED", probe, true]);
    assert.ok(Date.parse(status.retryNotBefore) > harness.clock.now);
    // Continue is refused until the cool-down ends, and sends nothing to RSI.
    const before = harness.rsi.requests.length;
    assert.deepEqual(await tab.request("CONTINUE_PARTIAL"), { ok: false, code: "RSI_COOLING_DOWN", retryNotBefore: status.retryNotBefore });
    assert.equal(harness.rsi.requests.length, before, "nothing was sent to RSI");
    // After the ban, Continue finishes the build with the unthrottled build's document.
    await harness.advanceBy(limiter.bannedUntil - harness.clock.now + 1);
    assert.equal((await tab.request("CONTINUE_PARTIAL")).code, "RUN_STARTED");
    assert.equal((await harness.finishJob(4 * HOUR)).status, "complete");
    assert.deepEqual(comparable(tab.events.findLast((event) => event.result).result), comparable(unthrottled.document));
  });
}

// RSI holds a limit in Financial ledgers (PARSER_HARDENING.md §15.5): one ledger request is answered 429 with a
// Retry-After of 60 seconds, or of 20 minutes. On the virtual clock the whole worker waits the production wait out:
// no account request goes to RSI before the refusal's Retry-After ends, the warning shows meanwhile, and the build
// then completes. The browser scenario ledgers-retry-after proves the same order with a short Retry-After.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";

const HOUR = 3_600_000;
const LEDGER_PATHS = new Set(["/api/account/creditLog", "/api/account/uecLog", "/api/account/recLog"]);
const isAccountRequest = (request) => request.origin === "https://robertsspaceindustries.com" && request.credentialsOmitted !== true;

for (const seconds of [60, 1200]) {
  test(`a ledger refusal with Retry-After: ${seconds} waits it out on the clock and completes`, async () => {
    const harness = await createExtensionHarness({ account: { counts: { pledges: 6, buybacks: 4, orders: 2, storeCredit: 12, uec: 6, rec: 4 } } });
    const tab = harness.openTab();
    harness.rsi.failNext((request) => LEDGER_PATHS.has(request.path), { status: 429, headers: { "retry-after": String(seconds) } });
    assert.equal((await tab.build()).code, "RUN_STARTED");
    await harness.advance(() => harness.rsi.requests.some((request) => LEDGER_PATHS.has(request.path)));
    const refusal = harness.rsi.requests.find((request) => LEDGER_PATHS.has(request.path));
    await harness.advanceBy(1000);
    const waiting = (await tab.request("GET_STATUS")).status;
    assert.equal(waiting.activeJob.pace.warning, "limited", "the warning shows while the build waits");
    assert.equal(waiting.activeJob.pace.lastSignal.retryAfterMs, seconds * 1000);
    assert.ok(Date.parse(waiting.activeJob.pace.waitingUntil) - refusal.at >= seconds * 1000, "the wait is at least the Retry-After");
    const final = await harness.finishJob(4 * HOUR);
    assert.equal(final.status, "complete");
    const after = harness.rsi.requests.filter((request) => request.at > refusal.at && isAccountRequest(request));
    assert.ok(after.length > 0, "the build went on after the wait");
    assert.ok(after.every((request) => request.at >= refusal.at + seconds * 1000), `an account request went to RSI ${Math.min(...after.map((request) => request.at)) - refusal.at} ms after the refusal`);
    assert.equal((await tab.request("GET_STATUS")).status.status, "complete");
  });
}

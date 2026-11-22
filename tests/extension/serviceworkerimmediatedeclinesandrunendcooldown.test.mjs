// Run start declines without retries, and the cool-down a run's end sets (PARSER_HARDENING.md §12.1, §8.4): a
// Retry-After longer than the budget is declined at once and the cool-down follows it; a signed-out session
// declines as before, with no retry and no cool-down; a run that gives up starts the cool-down, and a completed run
// clears it.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { IDENTIFY, RETRY_NOT_BEFORE_KEY, statusReads, identifies, refused } from "./serviceworkeridentifyrefusals.mjs";

test("a Retry-After longer than the budget is not waited for: the start is declined at once and the cool-down follows it", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.rsi.failNext((request) => request.path === IDENTIFY, refused("120"));
  // Without the status host's grant the feed is not read, and the finding says why.
  harness.statusPermission = false;
  const startedAt = harness.clock.now;
  const declined = await tab.build();
  assert.equal(declined.code, "RSI_RATE_LIMITED");
  assert.deepEqual([declined.diagnosis.probe, declined.diagnosis.status, declined.diagnosis.reason], ["not-run", "unknown", "no-permission"]);
  assert.equal(statusReads(harness).length, 0);
  assert.equal(identifies(harness).length, 1, "no attempt waits past the budget");
  assert.equal(harness.clock.now, startedAt);
  assert.equal(declined.retryNotBefore, new Date(startedAt + 120_000).toISOString());
});

test("a signed-out session declines as before, with no retry and no cool-down", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.signedIn = false;
  const declined = await tab.build();
  assert.equal(declined.code, "ACCOUNT_DISCOVERY_FAILED");
  assert.match(declined.message, /Sign in to RSI/u);
  assert.equal(harness.local.get(RETRY_NOT_BEFORE_KEY) ?? null, null);
});

test("a run that gives up starts the cool-down; a completed run clears it", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  // Every Hangar Log request is refused while `refusing` holds, so the run gives up for the time being (§8).
  let refusing = true;
  harness.rsi.failNext((request) => refusing && request.path === "/api/account/pledgeLog", { ...refused("60"), times: 1000 });
  assert.equal((await tab.build()).code, "RUN_STARTED");
  const stopped = await harness.finishJob();
  const job = await harness.repository.getJob(stopped.lastTerminalJobId);
  assert.deepEqual([job.status, job.failure.code], ["failed", "RSI_RATE_LIMITED"]);
  const retryNotBefore = harness.local.get(RETRY_NOT_BEFORE_KEY);
  // A run that gave up waits brakes.coolDownMs, 300,000 ms, longer than the 60 s Retry-After (§8.4).
  assert.equal(retryNotBefore, new Date(Date.parse(job.completedAt) + 300_000).toISOString());
  assert.equal((await tab.request("CONTINUE_PARTIAL")).code, "RSI_COOLING_DOWN");
  // After the cool-down the run is continued and completes, which clears it.
  refusing = false;
  await harness.advanceBy(Date.parse(retryNotBefore) - harness.clock.now);
  assert.equal((await tab.request("CONTINUE_PARTIAL")).code, "RUN_STARTED");
  assert.equal((await harness.finishJob()).status, "complete");
  assert.equal(harness.local.get(RETRY_NOT_BEFORE_KEY) ?? null, null);
});

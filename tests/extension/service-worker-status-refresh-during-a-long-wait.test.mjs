// While a warning shows, RSI's status feed stays current through a long wait (PARSER_HARDENING.md §7.5, §9.3): a
// ledger refusal with a Retry-After of 20 minutes gets a status read at each cache boundary, no more often, with no
// account request before the wait ends. The wake point is kept in the runtime record and an alarm, so a worker Chrome
// ended during the wait is woken for the next status read, and the build then completes.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";

const CACHE_MS = 300_000;
const WAIT_MS = 1_200_000;
const LEDGER_PATHS = new Set(["/api/account/creditLog", "/api/account/uecLog", "/api/account/recLog"]);
const STATUS_ORIGIN = "https://status.robertsspaceindustries.com";
const STATUS_REFRESH_ALARM = "citizendata.statusRefresh";
const isAccountRequest = (request) => request.origin === "https://robertsspaceindustries.com" && request.credentialsOmitted !== true;

async function refusedForTwentyMinutes() {
  const harness = await createExtensionHarness({ account: { counts: { pledges: 6, buybacks: 4, orders: 2, storeCredit: 12, uec: 6, rec: 4 } } });
  const tab = harness.openTab();
  harness.rsi.failNext((request) => LEDGER_PATHS.has(request.path), { status: 429, headers: { "retry-after": String(WAIT_MS / 1000) } });
  assert.equal((await tab.build()).code, "RUN_STARTED");
  await harness.advance(() => harness.rsi.requests.some((request) => LEDGER_PATHS.has(request.path)));
  const refusal = harness.rsi.requests.find((request) => LEDGER_PATHS.has(request.path));
  return { harness, tab, refusal };
}

// The status reads inside the wait, as offsets from the refusal: one per cache period, at its boundary.
function assertReadsAtBoundaries(harness, refusal) {
  const reads = harness.rsi.requests.filter((request) => request.origin === STATUS_ORIGIN && request.at >= refusal.at && request.at < refusal.at + WAIT_MS).map((request) => request.at - refusal.at);
  assert.ok(reads.length >= 4, `status reads at ${reads.join(", ")} ms`);
  for (let index = 1; index < reads.length; index += 1) {
    const gap = reads[index] - reads[index - 1];
    assert.ok(gap >= CACHE_MS && gap <= CACHE_MS + 1000, `status reads ${gap} ms apart: ${reads.join(", ")}`);
  }
  const early = harness.rsi.requests.filter((request) => request.at > refusal.at && request.at < refusal.at + WAIT_MS && isAccountRequest(request));
  assert.deepEqual(early.map((request) => request.path), [], "no account request before the wait ended");
}

test("a 20 minute Retry-After gets a status read at each cache boundary and no account request before it ends", async () => {
  const { harness, tab, refusal } = await refusedForTwentyMinutes();
  await harness.advanceBy(CACHE_MS / 2);
  const record = await harness.repository.getRuntime();
  assert.ok(Date.parse(record.statusRefreshAt) > harness.clock.now && Date.parse(record.statusRefreshAt) < refusal.at + WAIT_MS, `statusRefreshAt ${record.statusRefreshAt}`);
  assert.equal(harness.alarms.get(STATUS_REFRESH_ALARM)?.scheduledTime, Date.parse(record.statusRefreshAt), "the alarm at the wake point");
  const waitingJob = await harness.repository.getJob(record.activeJobId);
  const statusRequests = harness.rsi.requests.filter((request) => request.origin === STATUS_ORIGIN).length;
  assert.equal(waitingJob.actualRequestsByAllowance.statusChecks, statusRequests, "only real status requests consume the allowance");
  assert.equal((await harness.finishJob(4 * 3_600_000)).status, "complete");
  assertReadsAtBoundaries(harness, refusal);
  // The finished job keeps no wake point and no alarm.
  assert.equal((await harness.repository.getRuntime()).statusRefreshAt ?? null, null);
  assert.equal(harness.alarms.has(STATUS_REFRESH_ALARM), false);
  assert.equal((await tab.request("GET_STATUS")).status.status, "complete");
});

test("a fresh durable cache result consumes no status-check allowance", async () => {
  const harness = await createExtensionHarness({ account: { counts: { pledges: 6, buybacks: 4, orders: 2, storeCredit: 12, uec: 6, rec: 4 } } });
  const tab = harness.openTab();
  assert.equal((await tab.request("CHECK_RSI_STATUS")).ok, true);
  const before = harness.rsi.requests.filter((request) => request.origin === STATUS_ORIGIN).length;
  harness.rsi.failNext((request) => LEDGER_PATHS.has(request.path), { status: 429, headers: { "retry-after": String(WAIT_MS / 1000) } });
  assert.equal((await tab.build()).code, "RUN_STARTED");
  await harness.advance(async () => {
    const runtime = await harness.repository.getRuntime();
    const job = runtime?.activeJobId ? await harness.repository.getJob(runtime.activeJobId) : null;
    return job?.pace?.warning === "limited";
  });
  const runtime = await harness.repository.getRuntime();
  const job = await harness.repository.getJob(runtime.activeJobId);
  assert.equal(job.actualRequestsByAllowance.statusChecks, 0);
  assert.equal(harness.rsi.requests.filter((request) => request.origin === STATUS_ORIGIN).length, before);
});

test("a worker ended during the wait is woken at the persisted wake point for the next status read", async () => {
  const { harness, refusal } = await refusedForTwentyMinutes();
  await harness.advanceBy(CACHE_MS / 2);
  const wakeAt = Date.parse((await harness.repository.getRuntime()).statusRefreshAt);
  harness.stopWorker();
  assert.equal(harness.workerRunning(), false);
  const before = harness.rsi.requests.length;
  await harness.advance(() => harness.rsi.requests.slice(before).some((request) => request.origin === STATUS_ORIGIN));
  const read = harness.rsi.requests.slice(before).find((request) => request.origin === STATUS_ORIGIN);
  assert.equal(harness.workerRunning(), true, "an alarm woke the worker");
  assert.ok(read.at >= wakeAt && read.at - wakeAt <= 1000, `the status was read ${read.at - wakeAt} ms after the wake point`);
  assert.deepEqual(harness.rsi.requests.slice(before).filter(isAccountRequest).map((request) => request.path), [], "the wake sent no account request");
  assert.equal((await harness.finishJob(4 * 3_600_000)).status, "complete");
  assertReadsAtBoundaries(harness, refusal);
});

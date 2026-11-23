import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness, RSI_TOKEN, WATCHDOG_ALARM } from "../support/extension-harness.mjs";
import { assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { longestGap, resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a build from the hosted dashboard collects every section at its pacing and delivers one valid document", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  assert.deepEqual([...harness.alarms.keys()], [], "an idle extension holds no alarm");
  const startedAt = harness.clock.now;
  const started = await tab.build();
  assert.equal(started.ok, true);
  assert.equal(started.code, "RUN_STARTED");
  assert.equal(started.status.activeJob.mode, "baseline");
  assert.equal(started.status.controlSessionBound, true);
  assert.deepEqual([...harness.alarms.values()].map((alarm) => [alarm.name, alarm.periodInMinutes]), [[WATCHDOG_ALARM, 0.5]], "a running job holds one repeating watchdog alarm");

  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete");
  assert.deepEqual([...harness.alarms.keys()], [], "the watchdog is cleared when the job ends");
  const document = resultOf(tab);
  await assertCompleteDocument(document, harness.rsi);
  assert.equal(tab.events.filter((event) => event.result).length, 1, "the result is delivered once");
  assert.equal(document.account.handle, "SyntheticCitizen");
  assert.equal(document.generator.version, "0.42.2");

  // The run is recorded with the authorization it ran under.
  assert.equal(document.sync.runs.length, 1);
  assert.equal(document.sync.runs[0].status, "complete");
  assert.match(document.sync.runs[0].authorization.planHash, /^[0-9a-f]{64}$/u);
  assert.equal(document.sync.runs[0].authorization.extensionVersion, "0.42.2");

  // About one step a second for the whole run once the slow start has passed, and never a long pause. Every run starts
  // at half the pace and reaches it about 80 seconds in, which adds at most 30 seconds (§6.6 A). The account's
  // buy-backs are a few items many times over, and one page is read for an item, so the run is a few dozen steps.
  const seconds = (harness.clock.now - startedAt) / 1000;
  const requests = harness.rsi.requests;
  const steps = [...harness.repository.inspect().jobs.values()][0].requestCount;
  assert.ok(steps > 25 && seconds / steps > 0.9 && (seconds - 30) / steps < 1.3, `the run took ${seconds} s of extension time for ${steps} steps`);
  // The slow start's interval is the longest: 1,800 ms and up to 269 ms of jitter, with the margin today's bound had. A
  // billing section that reads the kept billing page sends no request, so two intervals can lie between two requests (D23).
  assert.ok(longestGap(requests) <= 2 * 2500, `longest pause between requests was ${longestGap(requests)} ms`);

  // The page parser is created on demand for exactly one stated purpose. It is given a document parser and nothing
  // that can make a request or read a cookie (tests/support/extension-harness.mjs), so reading a page is all it does.
  assert.deepEqual(harness.offscreenDocuments.map((details) => details.reasons), [["DOM_PARSER"]]);

  // The signed-in account is identified by RSI's own identify route before anything else is read, and the only tab
  // involved is the dashboard's: the extension opens none.
  assert.deepEqual([requests[0].method, requests[0].path], ["POST", "/api/spectrum/auth/identify"]);
  assert.deepEqual([...harness.tabs.keys()], [tab.id]);

  // The session token is read for each POST, sent only on POST routes, and kept nowhere.
  assert.ok(requests.filter((request) => request.method === "POST").every((request) => request.tokenSent));
  assert.ok(requests.filter((request) => request.method === "GET").every((request) => !request.tokenSent));
  assert.equal(harness.cookieReads, requests.filter((request) => request.method === "POST").length);
  const everythingKept = JSON.stringify([[...harness.local], [...harness.session], await harness.repository.exportBackup(), tab.events]);
  assert.ok(everythingKept.includes("SyntheticCitizen"));
  assert.ok(!everythingKept.includes(RSI_TOKEN), "the RSI session token must not be stored or sent to the dashboard");
  // Account data is never written to the console.
  assert.deepEqual(harness.consoleCalls, []);
});

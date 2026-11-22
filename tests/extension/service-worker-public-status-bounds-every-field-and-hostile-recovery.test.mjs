// The public status's bounds (PARSER_HARDENING.md §12.5): a failure, its signal and the pace are shown within their
// bounds, RSI's code and message only in the stopped run's signal, bounded and sanitized (criterion 7); and a job or runtime state written or restored with hostile values (more than 75
// activities, 2,000-character fields, unknown kinds, nested extra fields, negative, fractional and unsafe counts)
// reaches the dashboard only through the allowlists: at most 20 activities, each with its kind's fields alone.
import assert from "node:assert/strict";
import test from "node:test";
import { Model } from "../web/dashboard-scripts-under-test.mjs";
import { failedBuild } from "./failed-build-in-buybacks.mjs";
import { assertBoundedEverywhere, HOSTILE_MESSAGE, hostileJob, hostilePaceHistory, hostileRuntime, LONG, UNSAFE_PARTS } from "./public-status-hostile-values.mjs";

test("a failure, its signal and the pace are shown within their bounds, RSI's code and message only in the stop's detail", async () => {
  const { harness, tab, job } = await failedBuild();
  const signal = {
    kind: "limit", code: "RSI_HTML_HTTP_429", httpStatus: 429, rsiCode: "ErrRateLimited", rsiMessage: HOSTILE_MESSAGE, retryAfterMs: 60000, reason: null, method: "GET",
    route: "/account/pledges", page: 2, elapsedMs: 40, fromCanary: false, extra: "dropped", headers: { cookie: "Rsi-Token=deadbeef" }, body: "<html>"
  };
  const failure = { code: `${"C".repeat(100)}<script>`, message: `Line\u0000one\u0007${"m".repeat(900)}`, detail: { signal, diagnosis: null, contractFinding: { raw: "kept out" } } };
  await harness.repository.saveJob({ ...job, failure, pace: { ...job.pace, warning: "limited", wall: 4, lastSignal: signal, retryNotBefore: new Date(harness.clock.now + 30_000).toISOString() } });
  const shown = (await tab.status()).activeJob;
  assert.equal(shown.failure.code, "RUN_FAILED", "an unsafe code is not shown");
  assert.equal(shown.failure.message.length, 500);
  assert.ok(![...shown.failure.message].some((character) => character < " "), "no control character");
  assert.deepEqual(Object.keys(shown.failure.detail).sort(), ["diagnosis", "signal"]);
  const panelKeys = ["code", "fromCanary", "httpStatus", "kind", "method", "page", "reason", "retryAfterMs", "route"];
  // The stop's signal carries RSI's code and its message, bounded and sanitized; no header, body or extra field.
  const stopped = shown.failure.detail.signal;
  assert.deepEqual(Object.keys(stopped).sort(), [...panelKeys, "rsiCode", "rsiMessage"].sort());
  assert.equal(stopped.rsiCode, "ErrRateLimited");
  assert.ok([...stopped.rsiMessage].length <= 160, `${[...stopped.rsiMessage].length} characters`);
  assert.match(stopped.rsiMessage, /Too many requests from \[address\] and \[address\]/u);
  assert.match(stopped.rsiMessage, /token \[redacted\]/u);
  for (const unsafe of UNSAFE_PARTS) assert.equal(stopped.rsiMessage.includes(unsafe), false, `the message kept ${unsafe}`);
  assert.ok(![...stopped.rsiMessage].some((character) => character < " "), "no control character");
  // The pace's last signal, shown while a run brakes, has no RSI code or message.
  assert.deepEqual(Object.keys(shown.pace.lastSignal).sort(), panelKeys);
  assert.equal(JSON.stringify(shown.pace.lastSignal).includes("Too many requests"), false);
  // The panel's technical detail names the HTTP status, RSI's code and RSI's message, as text.
  const detail = Model.stopTechnicalDetail(shown.failure);
  assert.match(detail, /^RUN_FAILED: Lineone/u);
  assert.match(detail, / \| HTTP status 429 \| RSI code ErrRateLimited \| RSI message: img src x onerror alert\(1\) Too many requests from \[address\]/u);
  for (const unsafe of UNSAFE_PARTS) assert.equal(detail.includes(unsafe), false, `the detail kept ${unsafe}`);
  // An RSI code outside its shape and a message with nothing left are not shown.
  await harness.repository.saveJob({ ...job, failure: { ...failure, detail: { signal: { ...signal, rsiCode: "<b>bad</b>", rsiMessage: "<<>>\u0007" } } } });
  const unsafe = (await tab.status()).activeJob.failure.detail.signal;
  assert.deepEqual([unsafe.rsiCode, unsafe.rsiMessage], [null, null]);
  assert.equal(Model.stopTechnicalDetail({ code: "RSI_RATE_LIMITED", message: "Stopped.", detail: { signal: unsafe } }), "RSI_RATE_LIMITED: Stopped. | HTTP status 429");
  await harness.repository.saveJob({ ...job, failure, pace: { ...job.pace, warning: "limited", wall: 4, lastSignal: signal, retryNotBefore: new Date(harness.clock.now + 30_000).toISOString() } });
  assert.deepEqual([shown.pace.factor, shown.pace.warning, shown.pace.wall, shown.pace.waitingUntil], [job.pace.factor, "limited", 4, new Date(harness.clock.now + 30_000).toISOString()]);
  assert.equal(shown.retriedHttpRequestCount, job.retriedHttpRequestCount ?? 0);
  assert.deepEqual(shown.setAsideSections, []);
  // The pacing summary names counts and the settings, never an account's data.
  const summaryKeys = ["acceptedRequests", "controllerVersion", "maximumFactor", "refusedRequests", "retriedRequests", "settingsFingerprint", "slowSteps"];
  assert.deepEqual(Object.keys(shown.pacingSummary).sort(), summaryKeys);
  assert.match(shown.pacingSummary.settingsFingerprint, /^[0-9a-f]{64}$/u);
  // A wait that has passed is not shown as one.
  await harness.advanceBy(31_000);
  assert.equal((await tab.status()).activeJob.pace.waitingUntil, null);
});

test("a stored job with hostile values is shown only through the allowlists", async () => {
  const { harness, tab, job } = await failedBuild();
  await harness.repository.saveJob(hostileJob(job, new Date(harness.clock.now).toISOString()));
  const status = await tab.status();
  assertBoundedEverywhere(status);
  const shown = status.activeJob;
  // The newest 20 of 81 stored lines are taken; of them the unknown kind, the 2,000-character section and route and
  // the unreadable time are dropped, and the negative count is shown as unknown.
  assert.deepEqual(shown.activityLog.map((activity) => activity.seq), [...Array.from({ length: 15 }, (_, index) => 62 + index), 80]);
  assert.equal(shown.activityLog.at(-1).recordsReceived, null);
  assert.deepEqual(shown.requestProgressBySection.pledges, { completed: 2, total: 5, totalKnown: true, subphase: "uec" });
  assert.deepEqual(shown.requestProgressBySection.buybacks, { completed: null, total: null, totalKnown: false, subphase: null });
  assert.deepEqual([shown.requestsBySection.pledges, shown.requestsBySection.buybacks, shown.requestsBySection.hangarLog], [3, undefined, undefined]);
  assert.ok(Object.keys(shown.requestsBySection).length <= 64);
  assert.deepEqual([shown.requestCount, shown.httpRequestCount, shown.nextEligibleAt, shown.mode, shown.sectionIndex], [0, 0, null, null, 0]);
  assert.deepEqual(Object.keys(shown.lastActivity).sort(), ["at", "kind", "method", "page", "pageCount", "recordsReceived", "recordsTotal", "responseStatus", "retryAfterMs", "route", "seq", "elapsedMs"].sort());
});

test("a recovery backup with hostile job and runtime values cannot bypass the limits, on import or afterwards", async () => {
  const { harness, tab, job } = await failedBuild();
  const backup = (await harness.popup.request("EXPORT_BACKUP")).backup;
  const at = new Date(harness.clock.now).toISOString();
  backup.stores.jobs = backup.stores.jobs.map((stored) => stored.jobId === job.jobId ? hostileJob(stored, at) : stored);
  backup.stores.runtime = backup.stores.runtime.map((record) => hostileRuntime(record, job.jobId));
  // The run's pace history record, restored as written, and a revision that is not a number.
  backup.stores.paceHistory = backup.stores.paceHistory.map((record) => record.historyKey === job.paceHistory.historyKey ? hostilePaceHistory(record) : record);
  assert.ok(backup.stores.paceHistory.some((record) => record.pacing?.controllerVersion === LONG), "the run has a pace history record");
  const revisionBefore = (await tab.status()).statusRevision;
  const imported = await harness.popup.request("IMPORT_BACKUP", { backup });
  assert.equal(imported.ok, true);
  for (const status of [imported.status, await tab.status()]) {
    assertBoundedEverywhere(status);
    assert.deepEqual([status.status, status.pendingProposalId, status.lastProposalAt, status.lastCompletedRunId], ["idle", null, null, null]);
    assert.equal(status.activeJob.activityLog.length, 16, "the newest 20 stored lines, less the 4 out of shape");
    assert.equal(JSON.stringify(status).includes(LONG.slice(0, 50)), false);
    assert.ok(Number.isSafeInteger(status.statusRevision) && status.statusRevision > revisionBefore, "the revision grows and stays a count");
    assert.deepEqual(Object.values(status.activeJob.pacingSummary), [null, null, null, null, null, null, null]);
  }
});

// A run start RSI refuses (PARSER_HARDENING.md §12.1, §12.2, §8.4): the identify request is tried again after the
// pace controller's waits, while the next attempt still ends inside the budget, and the start is declined inside
// the dashboard's 60 seconds with W-22. The cool-down that follows answers every run start RSI_COOLING_DOWN and
// sends nothing to RSI, survives a worker restart, and ends at its time. The first refused attempt starts one read
// of RSI's status feed; the decline carries its finding, which the public status shows until a run starts or the
// cool-down ends.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { IDENTIFY, RETRY_NOT_BEFORE_KEY, STATUS_ORIGIN, statusReads, identifies, refused } from "./serviceworkeridentifyrefusals.mjs";

const START_DIAGNOSIS_KEY = "citizendata.startDiagnosis";

test("a refused identify is tried again after the controller's waits; a later accepted answer starts the run", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.rsi.failNext((request) => request.path === IDENTIFY, { ...refused(), times: 2 });
  const startedAt = harness.clock.now;
  const started = await tab.build();
  assert.equal(started.code, "RUN_STARTED", started.message);
  const [first, second, third] = identifies(harness).map((request) => request.at - startedAt);
  assert.equal(first, 0);
  assert.ok(second - first >= 2500 && second - first <= 5000, `first wait ${second - first} ms`);
  assert.ok(third - second >= 5000 && third - second <= 10000, `second wait ${third - second} ms`);
  assert.equal(harness.local.get(RETRY_NOT_BEFORE_KEY) ?? null, null, "an accepted start sets no cool-down");
});

test("identify refused past the budget: declined inside 60 seconds with W-22, then a cool-down that sends nothing to RSI", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  let refusing = true;
  harness.rsi.failNext((request) => refusing && request.path === IDENTIFY, { ...refused(), times: 1000 });
  const startedAt = harness.clock.now;
  const declined = await tab.build();
  const endedAt = harness.clock.now;
  assert.deepEqual([declined.ok, declined.code, declined.message], [false, "RSI_RATE_LIMITED", "RSI refused or didn't answer the account check."]);
  // The status feed was read once, without cookies, when the first attempt was refused; the request without cookies
  // was not sent, the account's handle being unknown.
  const { checkedAt, ...finding } = declined.diagnosis;
  assert.deepEqual(finding, { probe: "not-run", status: "ok", reason: null, components: [] });
  assert.ok(Date.parse(checkedAt) >= startedAt && Date.parse(checkedAt) <= endedAt);
  assert.deepEqual(statusReads(harness).map((request) => [request.path, request.credentialsOmitted]), [["/index.json", true]]);
  assert.equal(harness.rsi.requests.filter((request) => request.origin !== STATUS_ORIGIN && request.credentialsOmitted).length, 0);
  assert.deepEqual(harness.local.get(START_DIAGNOSIS_KEY), declined.diagnosis);
  assert.deepEqual((await tab.request("GET_STATUS")).status.startDiagnosis, declined.diagnosis);
  assert.ok(endedAt - startedAt < 60_000, `declined after ${endedAt - startedAt} ms`);
  const starts = identifies(harness).map((request) => request.at - startedAt);
  assert.ok(starts.length >= 3, `${starts.length} attempts`);
  assert.ok(starts.at(-1) <= 20_000, `the last attempt started ${starts.at(-1)} ms in`);
  assert.equal(declined.retryNotBefore, new Date(endedAt + 60_000).toISOString());
  assert.equal(harness.local.get(RETRY_NOT_BEFORE_KEY), declined.retryNotBefore);
  assert.equal(harness.state().status, "idle");
  assert.equal((await harness.repository.listJobs()).length, 0);

  // Every run start answers RSI_COOLING_DOWN until then, without a request, and a restarted worker still knows it.
  const before = harness.rsi.requests.length;
  for (const request of [() => tab.build(), () => tab.request("CONTINUE_PARTIAL"), () => tab.request("PROPOSE_ORGANIZATION_ROSTER", { organizationSids: ["SYNTH"] })]) {
    assert.deepEqual(await request(), { ok: false, code: "RSI_COOLING_DOWN", retryNotBefore: declined.retryNotBefore });
  }
  harness.stopWorker();
  assert.equal((await tab.build()).code, "RSI_COOLING_DOWN");
  assert.equal(harness.rsi.requests.length, before, "nothing was sent to RSI");
  assert.deepEqual((await tab.request("GET_STATUS")).status.startDiagnosis, declined.diagnosis, "a restarted worker still shows it");

  // Once it has passed, Build starts a run.
  refusing = false;
  await harness.advanceBy(Date.parse(declined.retryNotBefore) - harness.clock.now);
  assert.equal((await tab.request("GET_STATUS")).status.startDiagnosis, null, "the cool-down has ended");
  assert.equal((await tab.build()).code, "RUN_STARTED");
  assert.equal(harness.local.get(START_DIAGNOSIS_KEY) ?? null, null, "a run that starts removes it");
});

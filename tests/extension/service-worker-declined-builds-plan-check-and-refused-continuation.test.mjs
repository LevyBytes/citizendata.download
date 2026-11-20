import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";

test("a build is declined before any collection when RSI access or the RSI session is missing", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.rsiPermission = false;
  const noPermission = await tab.build();
  assert.equal(noPermission.ok, false);
  assert.equal(noPermission.code, "HOST_PERMISSION_REQUIRED");
  assert.match(noPermission.message, /Allow RSI access/u);
  assert.equal(harness.rsi.requests.length, 0);
  assert.equal(harness.state().status, "idle");

  harness.rsiPermission = true;
  harness.signedIn = false;
  const signedOut = await tab.build();
  assert.equal(signedOut.ok, false);
  assert.equal(signedOut.code, "ACCOUNT_DISCOVERY_FAILED");
  assert.match(signedOut.message, /Sign in to RSI/u);
  assert.equal(harness.rsi.requests.length, 0, "nothing is requested without a session token");
  assert.equal(harness.state().activeJobId, null);
  assert.deepEqual([...harness.alarms.keys()], []);
  assert.equal((await harness.repository.listJobs()).length, 0);

  harness.signedIn = true;
  assert.equal((await tab.build()).code, "RUN_STARTED");
  assert.equal((await tab.build()).code, "JOB_ALREADY_ACTIVE", "one job at a time");
});

test("a build plan is checked by the extension, not trusted from the page", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: 1 }, minimumInterRequestDelayMs: 900 };
  assert.equal((await tab.request("PROPOSE_BUILD", { ...plan, minimumInterRequestDelayMs: 100 })).code, "INVALID_PACING");
  assert.equal((await tab.request("PROPOSE_BUILD", { ...plan, selectedSections: ["profile", "account.password"], maximumRecordsBySection: { profile: 1, "account.password": 1 } })).ok, false);
  assert.equal((await tab.request("PROPOSE_BUILD", { ...plan, route: "/account/settings" })).code, "UNEXPECTED_PLAN_FIELD");
  // Whether a run is a first build, an update, or a continuation is the extension's decision, never the page's.
  assert.equal((await tab.request("PROPOSE_BUILD", { ...plan, mode: "update" })).code, "UNEXPECTED_PLAN_FIELD");
  assert.equal((await tab.request("PROPOSE_BUILD", { ...plan, url: "https://example.invalid/" })).code, "FORBIDDEN_PAYLOAD_FIELD");
  assert.equal((await tab.request("PROPOSE_BUILD", { ...plan, selectedSections: [] })).code, "EMPTY_PLAN");
  assert.equal((await tab.request("DELETE_EVERYTHING")).ok, false);
  assert.equal(harness.rsi.requests.length, 0);
  assert.equal((await harness.repository.listJobs()).length, 0);
});

test("a partial backup cannot be continued for a different RSI account", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.rsi.failNext((request) => request.path === "/api/account/buybackPledges", { status: 500 });
  await tab.build();
  assert.equal((await harness.finishJob()).status, "failed");
  harness.switchAccount({ handle: "SomeoneElse" });
  const refused = await tab.request("CONTINUE_PARTIAL");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "ACCOUNT_CHANGED");
  assert.equal(harness.state().activeJobId, null);
  // Only the account identification was sent to the other account.
  assert.deepEqual(harness.rsi.requests.map((request) => request.path), ["/api/spectrum/auth/identify"]);
});

test("a run that fails before the account is verified leaves nothing to open or continue", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.rsi.failNext((request) => request.path === "/en/citizens/SyntheticCitizen", { status: 500 });
  await tab.build();
  assert.equal((await harness.finishJob()).status, "failed");
  const status = await tab.status();
  assert.equal(status.partialAvailable, false);
  assert.equal(status.continuable, false);
  assert.equal((await tab.request("GET_PARTIAL_RESULT")).code, "NO_PARTIAL_RESULT");
  assert.equal((await tab.request("CONTINUE_PARTIAL")).code, "NO_PARTIAL_RESULT");
  // The popup can delete it.
  const [run] = (await harness.popup.request("LIST_INCOMPLETE_RUNS")).runs;
  assert.equal((await harness.popup.request("DELETE_INCOMPLETE_RUN", { runId: run.runId })).ok, true);
  assert.equal((await harness.popup.request("LIST_INCOMPLETE_RUNS")).runs.length, 0);
  assert.equal((await harness.popup.request("DELETE_INCOMPLETE_RUN", { runId: run.runId })).code, "RUN_NOT_DELETABLE");
});

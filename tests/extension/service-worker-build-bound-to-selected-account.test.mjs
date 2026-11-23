// A build or roster proposal that names the selected account (`expectedAccountKey`) starts only when RSI's identify
// route names that account. Otherwise it is declined after that one request, before any account section is read.
import assert from "node:assert/strict";
import test from "node:test";
import { Model } from "../support/extension-harness/extension-files-and-identifiers.mjs";
import { createExtensionHarness } from "../support/extension-harness.mjs";

const IDENTIFY = "/api/spectrum/auth/identify";

test("a build for another account than the one signed in is declined before any section request", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const declined = await tab.request("PROPOSE_BUILD", { plan: Model.buildDefaultPlan(), expectedAccountKey: "rsi:selectedcitizen" });
  assert.deepEqual([declined.ok, declined.code], [false, "SELECTED_ACCOUNT_MISMATCH"]);
  assert.match(declined.message, /Sign in to RSI as the selected account, or choose Add new account under Switch Account/u);
  assert.deepEqual(harness.rsi.requests.map((request) => request.path), [IDENTIFY], "only the identify request was sent");
  assert.equal(harness.state().status, "idle");
  assert.equal(harness.state().activeJobId, null);
  assert.equal((await harness.repository.listJobs()).length, 0);
});

test("a build for the account signed in starts, and the key is compared without letter case", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const started = await tab.request("PROPOSE_BUILD", { plan: Model.buildDefaultPlan(), expectedAccountKey: "rsi:syntheticcitizen" });
  assert.equal(started.code, "RUN_STARTED", started.message);
  assert.equal((await harness.finishJob()).status, "complete");
});

test("a proposal that names an account must name it by its key and nothing else", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const plan = Model.buildDefaultPlan();
  for (const payload of [
    { plan, expectedAccountKey: "SyntheticCitizen" },
    { plan, expectedAccountKey: "rsi:syntheticcitizen", mode: "update" },
    { plans: plan, expectedAccountKey: "rsi:syntheticcitizen" }
  ]) assert.equal((await tab.request("PROPOSE_BUILD", payload)).code, "INVALID_ACCOUNT_PROPOSAL", JSON.stringify(Object.keys(payload)));
  assert.equal((await tab.request("PROPOSE_BUILD", { plan, expectedAccountKey: "rsi:syntheticcitizen", sourceUrl: "https://example.invalid/" })).code, "FORBIDDEN_PAYLOAD_FIELD");
  assert.equal(harness.rsi.requests.length, 0);
  // A dashboard of an earlier release sends the plan by itself, and its build starts as before.
  assert.equal((await tab.build()).code, "RUN_STARTED");
});

test("a roster run for another account than the one signed in is declined before any roster request", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const declined = await tab.request("PROPOSE_ORGANIZATION_ROSTER", { roster: { organizationSids: ["SYNTH"] }, expectedAccountKey: "rsi:selectedcitizen" });
  assert.deepEqual([declined.ok, declined.code], [false, "SELECTED_ACCOUNT_MISMATCH"]);
  assert.deepEqual(harness.rsi.requests.map((request) => request.path), [IDENTIFY]);
  assert.equal((await harness.repository.listJobs()).length, 0);
});

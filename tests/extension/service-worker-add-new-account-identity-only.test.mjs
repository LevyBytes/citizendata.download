// Add new account through the extension (DISCOVER_CURRENT_ACCOUNT): the account signed in to RSI is found by RSI's
// identify route alone, its safe summary is kept, and no section is read and no build is proposed or started.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";

const IDENTIFY = "/api/spectrum/auth/identify";

test("Add new account sends only RSI's identify request, keeps the summary, and starts nothing", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const found = await tab.request("DISCOVER_CURRENT_ACCOUNT");
  assert.equal(found.ok, true, found.message);
  assert.equal(found.added, true);
  assert.deepEqual(found.account, { key: "rsi:syntheticcitizen", handle: "SyntheticCitizen", displayName: "Synthetic Citizen", registered: true, hasRetainedBuild: false, retainedExportedAt: null });
  assert.deepEqual(harness.rsi.requests.map((request) => [request.method, request.path]), [["POST", IDENTIFY]], "no section is read");
  assert.equal(harness.state().status, "idle");
  assert.equal(harness.state().activeJobId, null);
  assert.equal((await harness.repository.listJobs()).length, 0, "no build was proposed");
  assert.deepEqual([...harness.alarms.keys()], []);
  // The summary is all that is kept: no token and no address.
  const stored = JSON.stringify([...harness.local]);
  assert.match(stored, /SyntheticCitizen/u);
  assert.doesNotMatch(stored, /synthetic-session-token|avatar-self|https?:/u);
  const listed = await tab.request("LIST_ACCOUNTS");
  assert.deepEqual([listed.ok, listed.selectedKey, listed.accounts.map((entry) => entry.key)], [true, "rsi:syntheticcitizen", ["rsi:syntheticcitizen"]]);
});

test("adding the same signed-in account twice keeps one entry; another account is added beside it", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  assert.equal((await tab.request("DISCOVER_CURRENT_ACCOUNT")).added, true);
  const again = await tab.request("DISCOVER_CURRENT_ACCOUNT");
  assert.deepEqual([again.ok, again.added, again.account.key], [true, false, "rsi:syntheticcitizen"]);
  harness.switchAccount({ handle: "OtherCitizen" });
  // One check an interval, whatever the RSI session.
  await harness.advanceBy(30001);
  const other = await tab.request("DISCOVER_CURRENT_ACCOUNT");
  assert.deepEqual([other.added, other.account.handle], [true, "OtherCitizen"]);
  const listed = await tab.request("LIST_ACCOUNTS");
  assert.deepEqual(listed.accounts.map((entry) => entry.key), ["rsi:syntheticcitizen", "rsi:othercitizen"]);
  assert.equal(listed.selectedKey, "rsi:othercitizen", "the account just added is the one selected");
});

test("Add new account is refused, and nothing is kept, without RSI access, when signed out, or when RSI refuses", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.rsiPermission = false;
  assert.equal((await tab.request("DISCOVER_CURRENT_ACCOUNT")).code, "HOST_PERMISSION_REQUIRED");
  harness.rsiPermission = true;
  harness.signedIn = false;
  const signedOut = await tab.request("DISCOVER_CURRENT_ACCOUNT");
  assert.deepEqual([signedOut.ok, signedOut.code], [false, "RSI_SIGNED_OUT"]);
  assert.match(signedOut.message, /Sign in to robertsspaceindustries\.com/u);
  assert.equal(harness.rsi.requests.length, 0, "nothing is requested without a session token");
  harness.signedIn = true;
  await harness.advanceBy(30001);
  harness.rsi.failNext((request) => request.path === IDENTIFY, { status: 429 });
  const limited = await tab.request("DISCOVER_CURRENT_ACCOUNT");
  assert.deepEqual([limited.ok, limited.code], [false, "RSI_RATE_LIMITED"]);
  assert.equal(harness.rsi.requests.length, 1, "a refusal is not retried");
  assert.deepEqual((await tab.request("LIST_ACCOUNTS")).accounts, []);
  assert.equal(harness.state().activeJobId, null);
});

test("Add new account is refused while a build runs, and its payload must be empty", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  assert.equal((await tab.build()).code, "RUN_STARTED");
  const requestsBefore = harness.rsi.requests.length;
  const refused = await tab.request("DISCOVER_CURRENT_ACCOUNT");
  assert.deepEqual([refused.ok, refused.code], [false, "JOB_ALREADY_ACTIVE"]);
  assert.equal(harness.rsi.requests.length, requestsBefore, "nothing more is sent to RSI");
  assert.equal((await tab.request("DISCOVER_CURRENT_ACCOUNT", { handle: "Someone" })).code, "INVALID_ACCOUNT_PAYLOAD");
  assert.equal((await tab.request("GET_ACCOUNT_BUILD", { accountKey: "https://example.invalid/" })).code, "INVALID_ACCOUNT_PAYLOAD");
  assert.equal((await tab.request("SELECT_ACCOUNT", { accountKey: "rsi:a", extra: true })).code, "INVALID_ACCOUNT_PAYLOAD");
});

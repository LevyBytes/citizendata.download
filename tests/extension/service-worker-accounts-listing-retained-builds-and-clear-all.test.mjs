// What the extension lists and hands over (LIST_ACCOUNTS, GET_ACCOUNT_BUILD, SELECT_ACCOUNT): every added account,
// and a retained build only while Build History is on. Clear All removes the added accounts with everything else.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";

// Build History is on until the user turns it off (storage/build-history.js); each test sets it as it needs.
async function builtAccount(historyEnabled) {
  const harness = await createExtensionHarness({ account: { counts: { pledges: 3, buybacks: 3 } } });
  const tab = harness.openTab();
  assert.equal((await tab.build()).code, "RUN_STARTED");
  assert.equal((await harness.finishJob()).status, "complete");
  assert.equal((await harness.popup.request("SET_BUILD_HISTORY", { enabled: historyEnabled })).ok, true);
  return { harness, tab };
}

test("with Build History off, a built account is not listed or handed over unless it was added", async () => {
  const { harness, tab } = await builtAccount(false);
  const listed = await tab.request("LIST_ACCOUNTS");
  assert.deepEqual([listed.ok, listed.accounts, listed.buildHistory], [true, [], false]);
  assert.equal((await tab.request("GET_ACCOUNT_BUILD", { accountKey: "rsi:syntheticcitizen" })).code, "BUILD_HISTORY_OFF");
  const requestsBefore = harness.rsi.requests.length;
  assert.equal((await tab.request("DISCOVER_CURRENT_ACCOUNT")).ok, true);
  const added = (await tab.request("LIST_ACCOUNTS")).accounts;
  assert.deepEqual(added.map((entry) => [entry.key, entry.registered, entry.hasRetainedBuild]), [["rsi:syntheticcitizen", true, false]]);
  assert.equal(harness.rsi.requests.length, requestsBefore + 1, "listing asks nothing of RSI; adding asked one identify request");
});

test("with Build History on, the retained build is listed and handed over by its account key", async () => {
  const { harness, tab } = await builtAccount(true);
  const requestsBefore = harness.rsi.requests.length;
  const listed = await tab.request("LIST_ACCOUNTS");
  assert.equal(listed.accounts.length, 1);
  const [entry] = listed.accounts;
  assert.deepEqual([entry.key, entry.handle, entry.registered, entry.hasRetainedBuild], ["rsi:syntheticcitizen", "SyntheticCitizen", false, true]);
  const build = await tab.request("GET_ACCOUNT_BUILD", { accountKey: entry.key });
  assert.equal(build.ok, true);
  assert.equal(build.result.account.handle, "SyntheticCitizen");
  assert.equal(build.result.exportedAt, entry.retainedExportedAt);
  assert.equal((await tab.request("GET_ACCOUNT_BUILD", { accountKey: "rsi:nobodyhere" })).code, "NO_BUILD_HELD");
  assert.equal(harness.rsi.requests.length, requestsBefore, "nothing is asked of RSI");
});

test("an account is selected only when the extension lists it", async () => {
  const { harness, tab } = await builtAccount(false);
  assert.equal((await tab.request("SELECT_ACCOUNT", { accountKey: "rsi:syntheticcitizen" })).code, "UNKNOWN_ACCOUNT", "Build History is off and the account was not added");
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  assert.deepEqual(await tab.request("SELECT_ACCOUNT", { accountKey: "rsi:syntheticcitizen" }), { ok: true, selectedKey: "rsi:syntheticcitizen" });
  assert.equal((await tab.request("LIST_ACCOUNTS")).selectedKey, "rsi:syntheticcitizen");
  assert.equal((await tab.request("SELECT_ACCOUNT", { accountKey: "rsi:nobodyhere" })).code, "UNKNOWN_ACCOUNT");
});

test("a finished build selects its account, which a page that connects again is told of, and adds no account", async () => {
  const harness = await createExtensionHarness({ account: { counts: { pledges: 3, buybacks: 3 } } });
  const tab = harness.openTab();
  harness.switchAccount({ handle: "OtherCitizen" });
  assert.equal((await tab.request("DISCOVER_CURRENT_ACCOUNT")).ok, true);
  assert.equal((await tab.request("LIST_ACCOUNTS")).selectedKey, "rsi:othercitizen");
  harness.switchAccount({ counts: { pledges: 3, buybacks: 3 } });
  const requestsBefore = harness.rsi.requests.length;
  // The moment the completion event reaches the page: what is stored, and what a page that reconnects then is told.
  const atEvent = [];
  tab.events.push = function push(...payloads) {
    for (const payload of payloads) if (payload.event === "complete") atEvent.push(harness.local.get("citizendata.accounts.v1")?.selectedKey, harness.openTab().request("LIST_ACCOUNTS"));
    return Array.prototype.push.apply(this, payloads);
  };
  assert.equal((await tab.build()).code, "RUN_STARTED");
  assert.equal((await harness.finishJob()).status, "complete");
  assert.deepEqual([atEvent[0], (await atEvent[1]).selectedKey], ["rsi:syntheticcitizen", "rsi:syntheticcitizen"]);
  const requestsOfTheBuild = harness.rsi.requests.length;
  const listed = await tab.reload().request("LIST_ACCOUNTS");
  assert.equal(listed.selectedKey, "rsi:syntheticcitizen");
  assert.deepEqual(listed.accounts.map((entry) => [entry.key, entry.registered]), [["rsi:othercitizen", true], ["rsi:syntheticcitizen", false]]);
  assert.ok(requestsOfTheBuild > requestsBefore);
  assert.equal(harness.rsi.requests.length, requestsOfTheBuild, "selecting asks nothing of RSI");
});

test("with Build History off, a finished build of an account not added selects nothing", async () => {
  const harness = await createExtensionHarness({ account: { counts: { pledges: 3, buybacks: 3 } } });
  const tab = harness.openTab();
  assert.equal((await harness.popup.request("SET_BUILD_HISTORY", { enabled: false })).ok, true);
  assert.equal((await tab.build()).code, "RUN_STARTED");
  assert.equal((await harness.finishJob()).status, "complete");
  const listed = await tab.request("LIST_ACCOUNTS");
  assert.deepEqual([listed.accounts, listed.selectedKey], [[], null]);
  assert.equal(harness.local.get("citizendata.accounts.v1")?.selectedKey ?? null, null, "nothing was selected or registered in storage");
});

test("Clear All removes the added accounts, so a page that connects again lists none", async () => {
  const { harness, tab } = await builtAccount(true);
  harness.switchAccount({ handle: "OtherCitizen" });
  assert.equal((await tab.request("DISCOVER_CURRENT_ACCOUNT")).ok, true);
  assert.equal((await tab.request("LIST_ACCOUNTS")).accounts.length, 2);
  assert.equal((await harness.popup.request("CLEAR_ALL")).ok, true);
  const reloaded = tab.reload();
  const listed = await reloaded.request("LIST_ACCOUNTS");
  assert.deepEqual([listed.accounts, listed.selectedKey], [[], null]);
  assert.equal([...harness.local.keys()].some((key) => key.startsWith("citizendata.accounts")), false);
});

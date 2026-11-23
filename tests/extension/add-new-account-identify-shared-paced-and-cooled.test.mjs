// Add new account's identify request (DISCOVER_CURRENT_ACCOUNT) has one slot: requests that arrive together share one
// request to RSI; at most one is sent an interval whatever the RSI session, a restarted worker and a restarted browser
// included; within it the same session is given the account already found; a refusal starts the cool-down; and a
// check a stopped worker or a closed browser left holds the next one off. The RSI is the test harness's stand-in.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";

const IDENTIFY = "/api/spectrum/auth/identify";
const identifies = (harness) => harness.rsi.requests.filter((request) => request.path === IDENTIFY).length;
const discover = (tab) => tab.request("DISCOVER_CURRENT_ACCOUNT");
await import("../../shared/request-pacing-settings.js");
const SECTIONS = Object.values(globalThis.CITIZENDATA_REQUEST_PACING.accountBuild.sections);

test("five requests at once share one identify request, and the interval gives the same session its account again", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const answers = await Promise.all(Array.from({ length: 5 }, () => discover(tab)));
  assert.deepEqual(answers.map((answer) => [answer.ok, answer.account?.key]), Array(5).fill([true, "rsi:syntheticcitizen"]));
  assert.equal(identifies(harness), 1);
  const again = await discover(harness.openTab());
  assert.deepEqual([again.ok, again.added, again.account.key, identifies(harness)], [true, false, "rsi:syntheticcitizen", 1]);
  harness.stopWorker();
  assert.deepEqual([(await discover(tab)).ok, identifies(harness)], [true, 1], "a restarted worker keeps the interval");
  await harness.restartBrowser();
  const closed = await discover(harness.openTab());
  assert.deepEqual([closed.code, typeof closed.retryNotBefore, identifies(harness)], ["ACCOUNT_CHECK_TOO_SOON", "string", 1], "a restarted browser keeps the slot");
  await harness.advanceBy(30001);
  assert.deepEqual([(await discover(tab)).ok, identifies(harness)], [true, 2], "after the interval the account is checked again");
  const [first, second] = harness.rsi.requests.filter((request) => request.path === IDENTIFY).map((request) => request.at);
  assert.ok(second - first >= Math.max(...SECTIONS.map((section) => section.intervalMs)), "no closer than a build's steps");
});

test("another RSI session within the interval waits for its end, and is then checked", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  assert.equal((await discover(tab)).ok, true);
  harness.switchAccount({ handle: "OtherCitizen" });
  const soon = await discover(tab);
  assert.deepEqual([soon.code, typeof soon.retryNotBefore, identifies(harness)], ["ACCOUNT_CHECK_TOO_SOON", "string", 0], "a new session does not shorten the wait");
  await harness.advanceBy(30001);
  const other = await discover(tab);
  assert.deepEqual([other.ok, other.added, other.account.key, identifies(harness)], [true, true, "rsi:othercitizen", 1]);
  // The first session is not given its account again from the record either: the record is the last check's.
  harness.switchAccount({});
  assert.equal((await discover(tab)).code, "ACCOUNT_CHECK_TOO_SOON");
});

test("a refused check starts the cool-down, in which nothing is sent, whatever the session", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.rsi.failNext((request) => request.path === IDENTIFY, { status: 429 });
  const limited = await discover(tab);
  assert.deepEqual([limited.ok, limited.code, typeof limited.retryNotBefore], [false, "RSI_RATE_LIMITED", "string"]);
  assert.equal(harness.state().retryNotBefore, limited.retryNotBefore);
  harness.switchAccount({ handle: "OtherCitizen" });
  const cooling = await discover(tab);
  assert.deepEqual([cooling.code, harness.rsi.requests.length], ["RSI_COOLING_DOWN", 0]);
});

test("signed out, a second request in the interval is told to wait; a check a stopped worker left holds the next off", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.signedIn = false;
  assert.equal((await discover(tab)).code, "RSI_SIGNED_OUT");
  const soon = await discover(tab);
  assert.deepEqual([soon.code, typeof soon.retryNotBefore, harness.rsi.requests.length], ["ACCOUNT_CHECK_TOO_SOON", "string", 0]);
  harness.signedIn = true;
  await harness.advanceBy(30001);
  // A check still waiting for RSI when the browser closed left its lease in the runtime record.
  const { id: _id, ...runtime } = await harness.repository.getRuntime();
  await harness.repository.saveRuntime({ ...runtime, accountDiscovery: { leaseUntil: new Date(Date.parse("2026-11-01T12:00:00.000Z") + 60000).toISOString() } });
  await harness.restartBrowser();
  const running = await discover(harness.openTab());
  assert.deepEqual([running.code, identifies(harness)], ["ACCOUNT_CHECK_RUNNING", 0], "a check a closed browser left holds the next one off");
  await harness.advanceBy(30001);
  assert.equal((await discover(harness.openTab())).ok, true);
});

test("Clear All removes the slot with the cool-down", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  assert.equal((await discover(tab)).ok, true);
  assert.equal(typeof harness.state().accountDiscovery?.nextAt, "string");
  assert.equal((await harness.popup.request("CLEAR_ALL")).ok, true);
  assert.equal(harness.state()?.accountDiscovery, undefined);
  harness.switchAccount({ handle: "OtherCitizen" });
  assert.equal((await discover(tab)).ok, true);
});

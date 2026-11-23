// Remove this account (REMOVE_ACCOUNT): the extension forgets one account, its summary, latest build, kept earlier
// builds and cancelled builds, with Build History on or off. Kept images are shared, so they stay. A removed selected
// account passes the selection to the first account still listed, or to none; a restarted worker keeps that.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { handedOver, image, plain } from "./kept-images-loaded-with-fixture-images.mjs";

const COUNTS = { pledges: 3, buybacks: 3 };
const SYNTHETIC = "rsi:syntheticcitizen";
const OTHER = "rsi:othercitizen";
async function finishBuild(harness, tab) {
  assert.equal((await tab.build()).code, "RUN_STARTED");
  assert.equal((await harness.finishJob()).status, "complete");
}
const listed = async (tab) => {
  const answer = plain(await tab.request("LIST_ACCOUNTS"));
  return [answer.accounts.map((entry) => entry.key), answer.selectedKey];
};
const snapshotHandles = (harness) => [...harness.repository.inspect().snapshots.keys()].sort();

// OtherCitizen built once, then SyntheticCitizen twice, which keeps an earlier build of it, and one kept image.
async function twoAccounts() {
  const harness = await createExtensionHarness({ account: { handle: "OtherCitizen", counts: COUNTS } });
  const tab = harness.openTab();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  await finishBuild(harness, tab);
  harness.switchAccount({ counts: COUNTS });
  await finishBuild(harness, tab);
  harness.rsi.addPledges(1);
  await finishBuild(harness, tab);
  assert.equal(plain(await tab.request("KEEP_IMAGES", { files: [handedOver(await image(1))] })).ok, true);
  return { harness, tab };
}

test("with Build History on, the selected account and its kept builds go; the other account and the images stay", async () => {
  const { harness, tab } = await twoAccounts();
  assert.deepEqual(await listed(tab), [[OTHER, SYNTHETIC], SYNTHETIC]);
  const copies = async () => plain(await harness.popup.request("GET_BUILD_HISTORY")).copies.map((copy) => copy.accountId);
  assert.deepEqual(await copies(), ["SyntheticCitizen"]);
  const removed = plain(await tab.request("REMOVE_ACCOUNT", { accountKey: SYNTHETIC }));
  assert.deepEqual([removed.ok, removed.removedKey, removed.selectedKey, removed.removed], [true, SYNTHETIC, OTHER, { builds: 1, copies: 1, runs: 0 }]);
  assert.deepEqual([await listed(tab), snapshotHandles(harness), await copies()], [[[OTHER], OTHER], ["OtherCitizen"], []]);
  assert.equal(plain(await harness.popup.request("GET_BUILD_HISTORY")).images.count, 1, "shared images stay until they are deleted");
  harness.stopWorker();
  assert.deepEqual(await listed(harness.openTab()), [[OTHER], OTHER], "a restarted worker lists the same");
  assert.equal(plain(await tab.request("GET_ACCOUNT_BUILD", { accountKey: SYNTHETIC })).code, "NO_BUILD_HELD");
});

test("with Build History off, an added account that is not selected goes with its build, and the selection stays", async () => {
  const { harness, tab } = await twoAccounts();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: false });
  assert.equal(plain(await tab.request("DISCOVER_CURRENT_ACCOUNT")).ok, true);
  harness.switchAccount({ handle: "OtherCitizen", counts: COUNTS });
  await harness.advanceBy(30001);
  assert.equal(plain(await tab.request("DISCOVER_CURRENT_ACCOUNT")).ok, true);
  assert.equal(plain(await tab.request("SELECT_ACCOUNT", { accountKey: SYNTHETIC })).ok, true);
  const removed = plain(await tab.request("REMOVE_ACCOUNT", { accountKey: OTHER }));
  assert.deepEqual([removed.ok, removed.selectedKey, removed.removed.builds], [true, SYNTHETIC, 1]);
  assert.deepEqual([await listed(tab), snapshotHandles(harness)], [[[SYNTHETIC], SYNTHETIC], ["SyntheticCitizen"]]);
});

test("the last account goes with its cancelled build, but not while a build runs, and then nothing is listed", async () => {
  const harness = await createExtensionHarness({ account: { counts: COUNTS } });
  const tab = harness.openTab();
  await finishBuild(harness, tab);
  assert.equal((await tab.build()).code, "RUN_STARTED");
  assert.equal(plain(await tab.request("REMOVE_ACCOUNT", { accountKey: SYNTHETIC })).code, "JOB_ALREADY_ACTIVE");
  assert.equal(plain(await tab.request("CANCEL")).ok, true);
  await harness.finishJob();
  assert.equal(plain(await harness.popup.request("LIST_INCOMPLETE_RUNS")).runs.length, 1);
  const removed = plain(await tab.request("REMOVE_ACCOUNT", { accountKey: SYNTHETIC }));
  assert.deepEqual([removed.ok, removed.selectedKey, removed.accounts, removed.removed], [true, null, [], { builds: 1, copies: 0, runs: 1 }]);
  assert.deepEqual([await listed(tab), snapshotHandles(harness)], [[[], null], []]);
  assert.equal(plain(await harness.popup.request("LIST_INCOMPLETE_RUNS")).runs.length, 0);
  assert.equal(plain(await tab.request("REMOVE_ACCOUNT", { accountKey: SYNTHETIC })).code, "UNKNOWN_ACCOUNT");
  assert.equal(plain(await tab.request("REMOVE_ACCOUNT", { accountKey: SYNTHETIC, extra: true })).code, "INVALID_ACCOUNT_PAYLOAD");
  assert.equal(plain(await tab.request("REMOVE_ACCOUNT", { accountKey: "https://example.invalid/" })).code, "INVALID_ACCOUNT_PAYLOAD");
});

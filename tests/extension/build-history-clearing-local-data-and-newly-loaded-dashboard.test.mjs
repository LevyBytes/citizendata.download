import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { AccountDocument, SMALL, account, build, history, plain } from "./build-history-loaded-with-fixture-builds-and-rosters.mjs";

test("clearing all local data removes the kept builds and the setting, and only the popup may ask", async () => {
  const { harness, tab } = await account();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true, keep: 9 });
  harness.rsi.addPledges(1);
  await build(harness, tab);
  const [copy] = (await history(harness)).copies;
  assert.ok(copy);

  // A page that is not the extension's own gets nothing, whatever it asks for.
  for (const type of ["GET_BUILD_HISTORY", "SET_BUILD_HISTORY", "GET_BUILD_HISTORY_COPY", "DELETE_BUILD_HISTORY_COPY", "CLEAR_BUILD_HISTORY"]) {
    const refused = plain(await harness.popup.request(type, { historyId: copy.historyId, enabled: false }, { sender: { id: "another-extension", url: "https://example.com/" } }));
    assert.deepEqual(refused, { ok: false, code: "UNTRUSTED_EXTENSION_PAGE" }, type);
  }
  assert.equal((await history(harness)).copies.length, 1);

  // The recovery backup holds the latest build and not the kept ones.
  const recovery = plain(await harness.popup.request("EXPORT_BACKUP"));
  assert.equal(recovery.backup.stores.snapshots.length, 1);
  assert.equal(JSON.stringify(recovery).includes(copy.historyId), false);

  // Clearing everything clears the setting too, so the history is on again as it is at first.
  assert.equal(plain(await harness.popup.request("CLEAR_ALL")).ok, true);
  assert.deepEqual(await history(harness), { ok: true, settings: { enabled: true, keep: 5 }, limits: { minimum: 1, maximum: 100 }, copies: [], storedBytes: 0, problem: null, organizationsProblem: null, images: { count: 0, bytes: 0 } });
  assert.deepEqual([...harness.local.keys()], []);
  assert.equal(await harness.repository.getHistoryData(copy.historyId), undefined);
});

test("a dashboard that has just loaded is given the latest build while the history is on, and nothing while it is off", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  // Nothing was built yet.
  assert.deepEqual(plain(await tab.request("GET_LATEST_BUILD")), { ok: false, code: "NO_BUILD", message: "The extension holds no finished build." });
  const first = await build(harness, tab);
  harness.rsi.addPledges(1);
  const second = await build(harness, tab);

  // A page that loads anew, with the history on as it is at first, is given the latest build, whole and unchanged.
  const reloaded = harness.openTab();
  const before = harness.rsi.requests.length;
  const given = plain(await reloaded.request("GET_LATEST_BUILD"));
  assert.deepEqual(Object.keys(given).sort(), ["ok", "result"]);
  assert.deepEqual(given.result, second);
  assert.notDeepEqual(given.result, first);
  assert.equal(await AccountDocument.verifyIntegrity(structuredClone(given.result)), true);
  assert.equal(harness.rsi.requests.length, before, "handing over the saved build asks RSI for nothing");

  // With the history off the page is given nothing by itself; the build stays saved for the next update.
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: false });
  assert.deepEqual(plain(await reloaded.request("GET_LATEST_BUILD")), { ok: false, code: "BUILD_HISTORY_OFF", message: "Build history is off, so the extension hands over no build by itself." });
  assert.equal(harness.repository.inspect().snapshots.size, 1);
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  assert.deepEqual(plain(await reloaded.request("GET_LATEST_BUILD")).result, second);
});

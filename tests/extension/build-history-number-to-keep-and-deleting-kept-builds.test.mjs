import assert from "node:assert/strict";
import test from "node:test";
import { Download, SETTINGS_KEY, account, build, history, plain, savedFile } from "./build-history-loaded-with-fixture-builds-and-rosters.mjs";

test("the number to keep is the user's, from 1 to 100, and is applied when a build is kept", async () => {
  const { harness, tab, first } = await account();
  for (const keep of [0, 101, 2.5, "3", null]) {
    assert.deepEqual(plain(await harness.popup.request("SET_BUILD_HISTORY", { keep })), { ok: false, code: "INVALID_BUILD_HISTORY_SETTING" }, String(keep));
  }
  assert.deepEqual(plain(await harness.popup.request("SET_BUILD_HISTORY", { enabled: "yes" })), { ok: false, code: "INVALID_BUILD_HISTORY_SETTING" });
  assert.equal(harness.local.has(SETTINGS_KEY), false);
  assert.deepEqual(plain(await harness.popup.request("SET_BUILD_HISTORY", { enabled: true, keep: 3 })).settings, { enabled: true, keep: 3 });

  const builds = [first];
  for (let index = 0; index < 4; index += 1) {
    harness.rsi.addPledges(1);
    builds.push(await build(harness, tab));
  }
  // Five builds: the latest is the saved backup and the three before it are kept, newest first. The first is gone.
  assert.deepEqual((await history(harness)).copies.map((copy) => copy.exportedAt), [builds[3].exportedAt, builds[2].exportedAt, builds[1].exportedAt]);

  // A smaller number deletes nothing by itself. It takes effect when the next changed build is kept.
  assert.deepEqual(plain(await harness.popup.request("SET_BUILD_HISTORY", { keep: 1 })).copies.length, 3);
  harness.rsi.addPledges(1);
  builds.push(await build(harness, tab));
  const after = await history(harness);
  assert.deepEqual(after.copies.map((copy) => copy.exportedAt), [builds[4].exportedAt]);
  assert.equal((await savedFile(harness, after.copies[0].historyId)).text, Download.serialize(builds[4]));
});

test("kept builds outlive turning the history off, and are deleted one at a time or all together", async () => {
  const { harness, tab, first } = await account();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  harness.rsi.addPledges(1);
  const second = await build(harness, tab);
  harness.rsi.addPledges(1);
  await build(harness, tab);
  const [newer, older] = (await history(harness)).copies;
  assert.deepEqual([newer.exportedAt, older.exportedAt], [second.exportedAt, first.exportedAt]);

  // Off: the copies stay and can still be saved; a changed build adds none.
  const off = plain(await harness.popup.request("SET_BUILD_HISTORY", { enabled: false }));
  assert.deepEqual([off.settings, off.copies.length], [{ enabled: false, keep: 5 }, 2]);
  harness.rsi.addPledges(1);
  await build(harness, tab);
  assert.equal((await history(harness)).copies.length, 2);
  assert.equal((await savedFile(harness, older.historyId)).text, Download.serialize(first));

  // One copy deleted: its data goes with it, the other stays.
  const afterDelete = plain(await harness.popup.request("DELETE_BUILD_HISTORY_COPY", { historyId: older.historyId }));
  assert.deepEqual(afterDelete.copies, [newer]);
  assert.deepEqual(plain(await harness.popup.request("GET_BUILD_HISTORY_COPY", { historyId: older.historyId })), { ok: false, code: "BUILD_HISTORY_COPY_NOT_FOUND" });
  assert.deepEqual(plain(await harness.popup.request("DELETE_BUILD_HISTORY_COPY", { historyId: older.historyId })), { ok: false, code: "BUILD_HISTORY_COPY_NOT_FOUND" });
  assert.equal(await harness.repository.getHistoryData(older.historyId), undefined);

  // All copies deleted: the setting and the saved backup are untouched.
  const cleared = plain(await harness.popup.request("CLEAR_BUILD_HISTORY"));
  assert.deepEqual([cleared.copies, cleared.storedBytes, cleared.settings], [[], 0, { enabled: false, keep: 5 }]);
  assert.equal(await harness.repository.getHistoryData(newer.historyId), undefined);
  assert.equal(harness.repository.inspect().snapshots.size, 1);
});

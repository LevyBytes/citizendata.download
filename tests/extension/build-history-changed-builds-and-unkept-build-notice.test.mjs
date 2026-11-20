import assert from "node:assert/strict";
import test from "node:test";
import { AccountDocument, Download, SETTINGS_KEY, account, build, history, plain, savedFile } from "./build-history-loaded-with-fixture-builds-and-rosters.mjs";

test("the history is on until it is turned off, and keeps nothing but changed builds", async () => {
  const { harness, tab, first } = await account();
  assert.deepEqual(await history(harness), { ok: true, settings: { enabled: true, keep: 5 }, limits: { minimum: 1, maximum: 100 }, copies: [], storedBytes: 0, problem: null, organizationsProblem: null, images: { count: 0, bytes: 0 } });
  assert.equal(harness.local.has(SETTINGS_KEY), false);

  // Off: a changed build replaces the saved one and nothing else is kept.
  const turnedOff = plain(await harness.popup.request("SET_BUILD_HISTORY", { enabled: false }));
  assert.deepEqual(turnedOff.settings, { enabled: false, keep: 5 });
  harness.rsi.addPledges(1);
  const second = await build(harness, tab);
  assert.equal(second.pledges.length, first.pledges.length + 1);
  assert.deepEqual((await history(harness)).copies, []);

  const turnedOn = plain(await harness.popup.request("SET_BUILD_HISTORY", { enabled: true }));
  assert.deepEqual(turnedOn.settings, { enabled: true, keep: 5 });
  assert.deepEqual(plain(harness.local.get(SETTINGS_KEY)), { enabled: true, keep: 5 });

  // On, with nothing new on the account: the build is saved as the latest, and no copy is kept.
  const third = await build(harness, tab);
  assert.notEqual(third.exportedAt, second.exportedAt);
  assert.deepEqual((await history(harness)).copies, []);

  // On, with a new pledge: the build that was the latest is kept, exactly as the dashboard saved it.
  harness.rsi.addPledges(2);
  const fourth = await build(harness, tab);
  const kept = await history(harness);
  assert.equal(kept.copies.length, 1);
  const [copy] = kept.copies;
  assert.equal(copy.exportedAt, third.exportedAt);
  assert.equal(copy.handle, third.account.handle);
  assert.equal(copy.fileName, Download.canonicalFileName(third));
  assert.equal(kept.storedBytes, copy.storedBytes);
  const file = await savedFile(harness, copy.historyId);
  assert.equal(file.fileName, copy.fileName);
  assert.equal(file.text, Download.serialize(third));
  assert.equal(copy.fileBytes, Buffer.byteLength(file.text));
  assert.equal(copy.storedBytes, file.gzipBase64.length);
  assert.ok(copy.storedBytes < copy.fileBytes / 4, `${copy.storedBytes} stored for a ${copy.fileBytes} byte file`);
  // The kept file is a complete backup in its own right.
  const reopened = JSON.parse(file.text);
  assert.equal(await AccountDocument.verifyIntegrity(reopened), true);
  AccountDocument.assertValid(reopened, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
  // The latest build is the saved backup, not a kept copy.
  assert.equal(fourth.pledges.length, third.pledges.length + 2);

  // Updates that find nothing new leave the kept copy where it is.
  await build(harness, tab);
  await build(harness, tab);
  assert.deepEqual((await history(harness)).copies, [copy]);
  assert.deepEqual(harness.consoleCalls, []);
});

test("a build that cannot be kept is still saved, and the popup is told", async () => {
  const { harness, tab, first } = await account();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  // The kept builds cannot be read while the next build finishes.
  const working = harness.repository;
  let failing = true;
  harness.repository = Object.freeze({ ...working, listHistory: async () => { if (failing) throw new Error("The history store could not be read."); return working.listHistory(); } });
  await harness.restartBrowser();
  harness.rsi.addPledges(1);
  const second = await build(harness, tab);
  failing = false;
  assert.equal(second.pledges.length, first.pledges.length + 1);
  assert.deepEqual([...working.inspect().snapshots.values()].map((snapshot) => snapshot.document.exportedAt), [second.exportedAt]);
  const told = await history(harness);
  assert.deepEqual(told.copies, []);
  assert.deepEqual(told.problem, { at: second.exportedAt, exportedAt: first.exportedAt });

  // The next build that is kept clears the notice.
  harness.rsi.addPledges(1);
  await build(harness, tab);
  const after = await history(harness);
  assert.deepEqual([after.copies.map((copy) => copy.exportedAt), after.problem], [[second.exportedAt], null]);
});

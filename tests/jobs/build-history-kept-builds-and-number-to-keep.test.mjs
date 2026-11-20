import assert from "node:assert/strict";
import test from "node:test";
import { FIRST, History, ON, SECOND, THIRD, backup, extraPledge } from "./build-history-loaded-with-fixture-backups.mjs";

test("nothing is kept when the history is off, there is no earlier build, or the account data is unchanged", async () => {
  const input = { accountId: "account-1", previous: backup(FIRST), document: backup(SECOND, { pledges: [extraPledge] }), entries: [], archivedAt: SECOND };
  assert.equal(await History.plan({ ...input, settings: { enabled: false, keep: 5 } }), null);
  // With no stored setting the history is on.
  assert.notEqual(await History.plan({ ...input, settings: undefined }), null);
  assert.equal(await History.plan({ ...input, settings: ON, previous: null }), null);
  assert.equal(await History.plan({ ...input, settings: ON, document: backup(SECOND) }), null);
  assert.equal(await History.plan({ ...input, settings: ON, accountId: "" }), null);
});

test("a changed build keeps the build it replaces", async () => {
  const previous = backup(FIRST);
  const planned = await History.plan({ settings: ON, accountId: "account-1", previous, document: backup(SECOND, { pledges: [extraPledge] }), entries: [], archivedAt: SECOND });
  const text = History.fileText(previous);
  assert.deepEqual(planned.add.entry, {
    historyId: `account-1:${FIRST}`,
    accountId: "account-1",
    handle: "Synthetic Citizen",
    exportedAt: FIRST,
    archivedAt: SECOND,
    fingerprint: await History.fingerprint(previous),
    fileName: "citizendata-Synthetic-Citizen-2026-11-01-120000-000Z.json",
    fileBytes: Buffer.byteLength(text),
    storedBytes: planned.add.data.gzipBase64.length
  });
  assert.equal(planned.add.data.historyId, planned.add.entry.historyId);
  assert.equal(Buffer.from(await History.unpack(planned.add.data.gzipBase64)).toString("utf8"), text);
  assert.deepEqual(planned.remove, []);
  // The same replacement planned again, after it was already stored, writes nothing.
  assert.equal(await History.plan({ settings: ON, accountId: "account-1", previous, document: backup(SECOND, { pledges: [extraPledge] }), entries: [planned.add.entry], archivedAt: THIRD }), null);
});

test("the number to keep is applied to one account when a build is added", async () => {
  const entry = (accountId, day) => ({ historyId: `${accountId}:2026-10-${day}T12:00:00.000Z`, accountId, exportedAt: `2026-10-${day}T12:00:00.000Z`, fingerprint: `f-${day}` });
  const entries = [entry("account-1", "03"), entry("account-2", "01"), entry("account-1", "01"), entry("account-1", "04"), entry("account-2", "02"), entry("account-1", "02")];
  const input = { accountId: "account-1", previous: backup(FIRST), document: backup(SECOND, { pledges: [extraPledge] }), entries, archivedAt: SECOND };
  // Three of this account's builds stay: the one being added and the two newest kept. The other account is untouched.
  const planned = await History.plan({ ...input, settings: { enabled: true, keep: 3 } });
  assert.deepEqual(planned.remove, ["account-1:2026-10-02T12:00:00.000Z", "account-1:2026-10-01T12:00:00.000Z"]);
  assert.deepEqual((await History.plan({ ...input, settings: { enabled: true, keep: 1 } })).remove.length, 4);
  assert.deepEqual((await History.plan({ ...input, settings: { enabled: true, keep: 5 } })).remove, []);
});

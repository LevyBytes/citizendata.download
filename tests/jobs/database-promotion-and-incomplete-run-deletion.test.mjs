import assert from "node:assert/strict";
import test from "node:test";
import { database, plain } from "./database-under-test.mjs";

test("promotion is atomic at the repository boundary and preserves the prior snapshot on failure", async () => {
  const repository = database.createMemoryRepository({ snapshots: [{ accountId: "account-1", runId: "old", document: { version: "old" } }] });
  // A run that already failed, was cancelled, or was promoted is not open, and a run with no staged record is unknown.
  for (const status of ["failed", "cancelled", "promoted"]) {
    await repository.saveStagedRun({ runId: "run-1", accountId: "account-1", status, results: [{ section: "profile" }] });
    await assert.rejects(repository.promoteRun({ runId: "run-1", accountId: "account-1", document: { version: "new" }, promotedAt: new Date(0).toISOString() }), /open staged run/u, status);
  }
  await assert.rejects(repository.promoteRun({ runId: "run-missing", accountId: "account-1", document: { version: "new" }, promotedAt: new Date(0).toISOString() }), /open staged run/u);
  assert.equal((await repository.getSnapshot("account-1")).document.version, "old");

  await repository.saveStagedRun({ runId: "run-1", accountId: "account-1", status: "collecting", results: [{ section: "profile" }], createdAt: "2026-11-01T00:00:00.000Z" });
  await repository.updateRun({ jobId: "job-1", decide: () => ({ page: { pageKey: database.pageKey("collection-1", "pledges", 1), collectionId: "collection-1", section: "pledges", step: 1, text: "{}", sha256: "0" } }) });
  await repository.promoteRun({
    runId: "run-1",
    accountId: "account-1",
    collectionId: "collection-1",
    document: { version: "new" },
    checkpoints: [{ checkpointKey: "account-1:profile", value: "done" }],
    receipts: [{ receiptId: "receipt-1", runId: "run-1" }],
    stagedRun: { runId: "run-1", accountId: "account-1", createdAt: "2026-11-01T00:00:00.000Z" },
    promotedAt: new Date(1000).toISOString()
  });
  assert.equal((await repository.getSnapshot("account-1")).document.version, "new");
  assert.equal((await repository.getCheckpoint("account-1:profile")).value, "done");
  // The document is kept once, as the saved backup: the promoted run keeps neither its results nor its pages.
  assert.deepEqual(plain(await repository.getStagedRun("run-1")), { runId: "run-1", accountId: "account-1", createdAt: "2026-11-01T00:00:00.000Z", status: "promoted", promotedAt: new Date(1000).toISOString() });
  assert.equal((await repository.listPages("collection-1", "pledges")).length, 0);
});

test("incomplete-run deletion cannot remove a promoted run", async () => {
  const repository = database.createMemoryRepository({ stagedRuns: [{ runId: "run-1", status: "promoted" }] });
  await assert.rejects(repository.deleteIncompleteRun("run-1"), /promoted run/u);
});

test("a promotion keeps the replaced build and drops the ones beyond the number to keep, in the same step", async () => {
  const kept = (id) => ({ add: { entry: { historyId: id, accountId: "account-1", exportedAt: id }, data: { historyId: id, gzipBase64: `data-${id}` } } });
  const repository = database.createMemoryRepository();
  const promote = async (runId, history) => {
    await repository.saveStagedRun({ runId, accountId: "account-1", status: "ready" });
    return repository.promoteRun({ runId, accountId: "account-1", document: { version: runId }, history, promotedAt: new Date(0).toISOString() });
  };
  await promote("run-1", null);
  assert.deepEqual(plain(await repository.listHistory()), []);
  await promote("run-2", kept("a"));
  await promote("run-3", { ...kept("b"), remove: ["a", "never-kept"] });
  assert.deepEqual(plain(await repository.listHistory()), [{ historyId: "b", accountId: "account-1", exportedAt: "b" }]);
  assert.deepEqual(plain(await repository.getHistoryData("b")), { historyId: "b", gzipBase64: "data-b" });
  assert.equal(await repository.getHistoryData("a"), undefined);

  // A kept build whose record and data disagree is refused, and the promotion with it: the saved backup stays.
  await repository.saveStagedRun({ runId: "run-4", accountId: "account-1", status: "ready" });
  await assert.rejects(
    repository.promoteRun({ runId: "run-4", accountId: "account-1", document: { version: "run-4" }, history: { add: { entry: { historyId: "c" }, data: { historyId: "d", gzipBase64: "x" } } }, promotedAt: new Date(0).toISOString() }),
    /one identifier/u
  );
  assert.equal((await repository.getSnapshot("account-1")).document.version, "run-3");

  // Kept builds are not part of a recovery backup, and restoring one leaves them in place.
  const backup = await repository.exportBackup();
  assert.equal(Object.keys(backup.stores).some((name) => database.HISTORY_STORES.includes(name)), false);
  await repository.restoreBackup(backup);
  assert.equal((await repository.listHistory()).length, 1);

  await promote("run-5", kept("e"));
  await repository.deleteHistory(["b"]);
  assert.deepEqual(plain(await repository.listHistory()).map((entry) => entry.historyId), ["e"]);
  assert.equal(await repository.getHistoryData("b"), undefined);
  await repository.clearHistory();
  assert.deepEqual(plain(await repository.listHistory()), []);
  assert.equal(await repository.getHistoryData("e"), undefined);

  await promote("run-6", kept("f"));
  await repository.clearAll();
  assert.deepEqual(plain(await repository.listHistory()), []);
  assert.equal(await repository.getHistoryData("f"), undefined);
});

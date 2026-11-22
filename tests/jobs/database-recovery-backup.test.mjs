import assert from "node:assert/strict";
import test from "node:test";
import { database, plain } from "./database-under-test.mjs";

const HISTORY_RECORD = { historyKey: "connection", kind: "aggregate", version: 1, runs: 1, acceptedRequests: 3, refusedRequests: 0, retriedRequests: 0, slowSteps: 0, signalCounts: [], latency: {}, updatedAt: "2026-11-21T12:00:00.000Z" };

test("recovery backup rejects unknown stores and restores all validated stores", async () => {
  const source = database.createMemoryRepository();
  await source.saveJob({ jobId: "job-1", runId: "run-1", status: "failed" });
  const backup = await source.exportBackup();
  const restored = database.createMemoryRepository();
  await restored.restoreBackup(backup);
  assert.equal((await restored.getJob("job-1")).status, "failed");
  await assert.rejects(restored.restoreBackup({ ...backup, stores: { ...backup.stores, unknown: [] } }), /store set/u);
  assert.equal(backup.databaseVersion, 6);
  assert.ok(Array.isArray(backup.stores.pages));
  assert.ok(Array.isArray(backup.stores.paceHistory));
  assert.ok(Array.isArray(backup.stores.statusFeedCache));
  // A recovery file written before the status-feed cache restores unchanged, and one of the version that had none.
  const { statusFeedCache: _statusFeedCache, ...withoutStatusFeed } = backup.stores;
  await restored.restoreBackup({ ...backup, databaseVersion: 5, stores: withoutStatusFeed });
  await assert.rejects(restored.restoreBackup({ ...backup, databaseVersion: 5 }), /store set/u);
  // A recovery file written by the version before the pace history, the build history, or kept images restores unchanged.
  const { paceHistory: _paceHistory, ...withoutPaceHistory } = withoutStatusFeed;
  for (const databaseVersion of [4, 3, 2]) await restored.restoreBackup({ ...backup, databaseVersion, stores: withoutPaceHistory });
  assert.equal((await restored.getJob("job-1")).status, "failed");
  await assert.rejects(restored.restoreBackup({ ...backup, databaseVersion: 4 }), /store set/u);

  // A recovery file written before the page store existed restores, with no stored pages.
  const { pages: _pages, ...earlierStores } = withoutPaceHistory;
  const earlier = database.createMemoryRepository({ pages: [{ pageKey: "c|pledges|000001" }] });
  await earlier.restoreBackup({ databaseVersion: 1, stores: earlierStores });
  assert.equal((await earlier.getJob("job-1")).status, "failed");
  assert.equal(earlier.inspect().pages.size, 0);
  await assert.rejects(earlier.restoreBackup({ databaseVersion: 1, stores: withoutPaceHistory }), /store set/u);
  await assert.rejects(earlier.restoreBackup({ databaseVersion: 7, stores: backup.stores }), /Unsupported/u);
});

test("the pace history goes into a recovery backup and comes back from it; an older backup restores with none", async () => {
  const source = database.createMemoryRepository({ paceHistory: [HISTORY_RECORD] });
  const backup = await source.exportBackup();
  assert.deepEqual(plain(backup.stores.paceHistory), [HISTORY_RECORD]);
  const restored = database.createMemoryRepository();
  await restored.restoreBackup(backup);
  assert.deepEqual(plain(await restored.listPaceHistory()), [HISTORY_RECORD]);
  const { paceHistory: _paceHistory, statusFeedCache: _statusFeedCache, ...withoutPaceHistory } = backup.stores;
  await restored.restoreBackup({ databaseVersion: 4, stores: withoutPaceHistory });
  assert.deepEqual(plain(await restored.listPaceHistory()), []);
});

test("a run's transaction reads and writes the pace history with its job; Clear All and an incomplete run's deletion remove it", async () => {
  const run = { ...HISTORY_RECORD, historyKey: "run:run-1" };
  const repository = database.createMemoryRepository({ jobs: [{ jobId: "job-1", runId: "run-1", status: "running" }], paceHistory: [HISTORY_RECORD] });
  let seen = null;
  await repository.updateRun({
    jobId: "job-1",
    runId: "run-1",
    withPaceHistory: true,
    decide: ({ job, paceHistory }) => {
      seen = paceHistory;
      return { job: { ...job, status: "paused" }, paceHistory: [run], removePaceHistory: ["connection"], outcome: {} };
    }
  });
  assert.deepEqual(plain(seen), [HISTORY_RECORD]);
  assert.equal((await repository.getJob("job-1")).status, "paused");
  assert.deepEqual(plain(await repository.listPaceHistory()).map((record) => record.historyKey), ["run:run-1"]);
  // Without the option, the decision sees no history.
  await repository.updateRun({ jobId: "job-1", decide: ({ paceHistory }) => { seen = paceHistory; return {}; } });
  assert.equal(seen, undefined);

  await repository.deleteIncompleteRun("run-1");
  assert.deepEqual(plain(await repository.listPaceHistory()), []);
  const cleared = database.createMemoryRepository({ paceHistory: [HISTORY_RECORD] });
  await cleared.clearAll();
  assert.deepEqual(plain(await cleared.listPaceHistory()), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./database-under-test.mjs";

test("recovery backup rejects unknown stores and restores all validated stores", async () => {
  const source = database.createMemoryRepository();
  await source.saveJob({ jobId: "job-1", runId: "run-1", status: "failed" });
  const backup = await source.exportBackup();
  const restored = database.createMemoryRepository();
  await restored.restoreBackup(backup);
  assert.equal((await restored.getJob("job-1")).status, "failed");
  await assert.rejects(restored.restoreBackup({ ...backup, stores: { ...backup.stores, unknown: [] } }), /store set/u);
  assert.equal(backup.databaseVersion, 4);
  assert.ok(Array.isArray(backup.stores.pages));
  // A recovery file written by the version before the build history, or before kept images, restores unchanged.
  await restored.restoreBackup({ ...backup, databaseVersion: 3 });
  await restored.restoreBackup({ ...backup, databaseVersion: 2 });
  assert.equal((await restored.getJob("job-1")).status, "failed");

  // A recovery file written before the page store existed restores, with no stored pages.
  const { pages: _pages, ...earlierStores } = backup.stores;
  const earlier = database.createMemoryRepository({ pages: [{ pageKey: "c|pledges|000001" }] });
  await earlier.restoreBackup({ databaseVersion: 1, stores: earlierStores });
  assert.equal((await earlier.getJob("job-1")).status, "failed");
  assert.equal(earlier.inspect().pages.size, 0);
  await assert.rejects(earlier.restoreBackup({ databaseVersion: 1, stores: backup.stores }), /store set/u);
  await assert.rejects(earlier.restoreBackup({ databaseVersion: 5, stores: backup.stores }), /Unsupported/u);
});

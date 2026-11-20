import assert from "node:assert/strict";
import test from "node:test";
import { database, plain } from "./database-under-test.mjs";

test("one update of a run writes its page, receipt, lease, staged record, and job together, or nothing", async () => {
  const repository = database.createMemoryRepository({
    jobs: [{ jobId: "job-1", runId: "run-1", status: "running", requestCount: 0 }],
    authorizations: [{ authorizationId: "auth-1", lastActivityAt: "old" }],
    stagedRuns: [{ runId: "run-1", status: "collecting", results: [] }]
  });
  const page = (step, extra = {}) => ({ pageKey: database.pageKey("collection-1", "pledges", step), collectionId: "collection-1", section: "pledges", step, text: `{"step":${step}}`, sha256: "0", ...extra });
  const seen = [];
  const outcome = await repository.updateRun({
    jobId: "job-1",
    authorizationId: "auth-1",
    runId: "run-1",
    withStagedRun: true,
    decide: (stored) => {
      seen.push(JSON.parse(JSON.stringify(stored)));
      return {
        page: page(1),
        receipt: { receiptId: "run-1:1", runId: "run-1" },
        authorization: { ...stored.authorization, lastActivityAt: "new" },
        stagedRun: { ...stored.stagedRun, results: [{ section: "profile" }] },
        job: { ...stored.job, requestCount: 1 },
        outcome: { stored: true }
      };
    }
  });
  assert.deepEqual(plain(outcome), { stored: true });
  assert.deepEqual(seen, [{ job: { jobId: "job-1", runId: "run-1", status: "running", requestCount: 0 }, authorization: { authorizationId: "auth-1", lastActivityAt: "old" }, stagedRun: { runId: "run-1", status: "collecting", results: [] } }]);
  assert.equal((await repository.getJob("job-1")).requestCount, 1);
  assert.equal((await repository.getAuthorization("auth-1")).lastActivityAt, "new");
  assert.equal((await repository.getStagedRun("run-1")).results.length, 1);
  assert.equal(repository.inspect().receipts.size, 1);
  assert.deepEqual(plain(await repository.listPages("collection-1", "pledges")).map((record) => record.step), [1]);

  // The staged record and the authorization are read only when asked for, and a decision that writes nothing changes nothing.
  assert.equal(await repository.updateRun({ jobId: "job-1", decide: (stored) => { seen.push(stored); return {}; } }), undefined);
  assert.deepEqual(Object.keys(seen[1]).filter((key) => seen[1][key] !== undefined), ["job"]);
  assert.equal((await repository.getJob("job-1")).requestCount, 1);

  // A decision that throws stores none of what it was about to write.
  await assert.rejects(repository.updateRun({ jobId: "job-1", decide: () => { throw new Error("declined"); } }), /declined/u);
  assert.equal((await repository.getJob("job-1")).requestCount, 1);

  // Pages of a section list in step order. A page that replaces the earlier ones removes them in the same update.
  await repository.updateRun({ jobId: "job-1", decide: () => ({ page: page(2) }) });
  await repository.updateRun({ jobId: "job-1", decide: () => ({ page: { ...page(1), pageKey: database.pageKey("collection-1", "pledges.other", 1), section: "pledges.other" } }) });
  await repository.updateRun({ jobId: "job-1", decide: () => ({ page: { ...page(1), pageKey: database.pageKey("collection-2", "pledges", 1), collectionId: "collection-2" } }) });
  assert.deepEqual(plain(await repository.listPages("collection-1", "pledges")).map((record) => record.step), [1, 2]);
  await repository.updateRun({ jobId: "job-1", decide: () => ({ removePages: [{ collectionId: "collection-1", section: "pledges" }], page: page(3, { checkpoint: true }) }) });
  assert.deepEqual(plain(await repository.listPages("collection-1", "pledges")).map((record) => [record.step, record.checkpoint]), [[3, true]]);
  assert.equal((await repository.listPages("collection-1", "pledges.other")).length, 1, "a section whose name starts the same keeps its pages");
  assert.equal((await repository.listPages("collection-2", "pledges")).length, 1, "another collection keeps its pages");
  await repository.deletePages("collection-1");
  assert.equal(repository.inspect().pages.size, 1, "deleting a collection removes every section of it and nothing else");
  assert.equal(database.pageKey("c", "pledges", 12), "c|pledges|000012");
  for (const invalid of [() => database.pageKey("", "pledges", 1), () => database.pageKey("c", "a|b", 1), () => database.pageKey("c", "pledges", 0), () => database.pageKey("c|d", "pledges", 1)]) assert.throws(invalid, { name: "TypeError" });
});

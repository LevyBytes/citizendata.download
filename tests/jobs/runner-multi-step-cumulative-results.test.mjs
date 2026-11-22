import assert from "node:assert/strict";
import test from "node:test";
import { authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { atBaseline, databaseApi, localAccountId, runnerApi, sectionOutcome } from "./runner-under-test.mjs";

test("multi-step adapters must replace staged data with an explicit cumulative result", async () => {
  let clock = 40_000;
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 2 }, minimumInterRequestDelayMs: 2500 };
  const auth = authorizationRecord(clock, {
    authorizationId: "66666666-6666-4666-8666-666666666666",
    runId: "77777777-7777-4777-8777-777777777777",
    selectedSections: ["pledges"],
    maximumRecordsBySection: { pledges: 2 },
    parserVersions: { pledges: "1" }
  });
  let step = 0;
  const adapter = {
    section: "pledges",
    version: "1",
    parserVersion: "1",
    collectStep: async () => {
      step += 1;
      const records = step === 1 ? [{ recordKey: "first" }] : [{ recordKey: "first" }, { recordKey: "second" }];
      return {
        ok: true,
        accountId: "account-1",
        done: step === 2,
        cursor: step === 1 ? { page: 2 } : null,
        recordCount: 1,
        cumulativeRecordCount: step,
        resultMode: "cumulative",
        parserResults: [{ section: "pledges", value: records, outcome: sectionOutcome(step === 2 ? "complete" : "partial", step) }]
      };
    }
  };
  const job = atBaseline(runnerApi.createJob({ jobId: "job-multistep", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(clock).toISOString() }));
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const runner = runnerApi.createSerialRunner({
    repository,
    registry: { adapters: [adapter] },
    nowMs: () => clock,
    random: () => 0,
    assembleDocument: async ({ staged }) => ({ results: staged.results })
  });

  assert.equal((await runner.tick(job.jobId)).ok, true);
  clock += 2500;
  assert.equal((await runner.tick(job.jobId)).ok, true);
  const promoted = (await repository.getSnapshot("account-1")).document;
  assert.equal(promoted.results.length, 1);
  assert.equal(promoted.results[0].value.length, 2);
  assert.equal(promoted.results[0].value[0].recordKey, "first");
  assert.equal(promoted.results[0].value[1].recordKey, "second");
  assert.equal((await repository.getJob(job.jobId)).recordsBySection.pledges, 2);
  assert.equal((await repository.getJob(job.jobId)).requestsBySection.pledges, 2);
});

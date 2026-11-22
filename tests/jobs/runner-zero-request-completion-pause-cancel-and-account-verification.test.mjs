import assert from "node:assert/strict";
import test from "node:test";
import { assembleCanonical, authorizationRecord, profile } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { atBaseline, databaseApi, localAccountId, runnerApi } from "./runner-under-test.mjs";

test("cached adapter completion resolves zero actual HTTP requests", async () => {
  const clock = 15_000;
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: 1 }, minimumInterRequestDelayMs: 900 };
  const auth = authorizationRecord(clock, {
    authorizationId: "12121212-1212-4212-8212-121212121212",
    runId: "34343434-3434-4434-8434-343434343434"
  });
  const job = atBaseline(runnerApi.createJob({ jobId: "job-cached", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(clock).toISOString() }));
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  let minimumStagger;
  const runner = runnerApi.createSerialRunner({
    repository,
    nowMs: () => clock,
    random: () => 0,
    registry: { adapters: [{ section: "profile", version: "1", parserVersion: "1", collectStep: async (input) => {
      minimumStagger = input.concurrentRequestStaggerMs;
      return {
        ok: true, accountId: "account-1", done: true, recordCount: 1, cumulativeRecordCount: 1, resultMode: "cumulative", parserResults: [profile()],
        requestActivities: [], requestProgress: { completed: 1, total: 1, totalKnown: true, subphase: null }
      };
    } }] },
    assembleDocument: assembleCanonical
  });

  assert.equal((await runner.tick(job.jobId)).ok, true);
  const completed = await repository.getJob(job.jobId);
  assert.equal(completed.httpRequestCount, 0);
  assert.equal(completed.requestTotalsBySection.profile, 0);
  assert.equal(completed.resolvedRequestTotalsForSections, 1);
  assert.equal(completed.httpRequestsTotal, 0);
  assert.equal(minimumStagger, 450);
});

test("runner pause, resume, and cancel preserve durable state and revoke authorization", async () => {
  let clock = 20_000;
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: 1 }, minimumInterRequestDelayMs: 2500 };
  const auth = authorizationRecord(clock);
  const job = atBaseline(runnerApi.createJob({ jobId: "job-2", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, plan, now: new Date(clock).toISOString() }));
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const runner = runnerApi.createSerialRunner({ repository, registry: { adapters: [] }, nowMs: () => clock });
  assert.equal((await runner.pause(job.jobId)).job.status, "paused");
  assert.equal((await runner.resume(job.jobId)).job.status, "running");
  clock += 1;
  assert.equal((await runner.cancel(job.jobId)).job.status, "cancelled");
  assert.ok((await repository.getAuthorization(auth.authorizationId)).revokedAt);
  assert.equal((await repository.getStagedRun(job.runId)).runReceipt.status, "cancelled");
});

test("runner refuses to stage data before the adapter verifies the authorized account", async () => {
  const clock = 30_000;
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: 1 }, minimumInterRequestDelayMs: 2500 };
  const auth = authorizationRecord(clock);
  const job = atBaseline(runnerApi.createJob({ jobId: "job-3", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(clock).toISOString() }));
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const runner = runnerApi.createSerialRunner({
    repository,
    nowMs: () => clock,
    registry: { adapters: [{ section: "profile", collectStep: async () => ({ ok: true, accountId: "different-account", done: true, parserResults: [profile()] }) }] },
    assembleDocument: assembleCanonical
  });
  const result = await runner.tick(job.jobId);
  assert.equal(result.ok, false);
  assert.equal((await repository.getJob(job.jobId)).failure.code, "ACCOUNT_NOT_VERIFIED");
  assert.equal((await repository.getStagedRun(job.runId)).results.length, 0);
  assert.equal((await repository.getStagedRun(job.runId)).runReceipt.status, "failed");
});

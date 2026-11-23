import assert from "node:assert/strict";
import test from "node:test";
import { assembleCanonical, authorizationRecord, profile } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { accountDocumentApi, assemblerApi, databaseApi, localAccountId, runnerApi } from "./runner-under-test.mjs";

test("canonical runner completion preserves a previous complete section when a rerun is partial", async () => {
  const clock = Date.parse("2026-11-17T13:00:00.000Z");
  const baseline = await assemblerApi.assemble({
    account: { localAccountId, ueeCitizenRecord: 42, handle: "Citizen" },
    exportedAt: "2026-11-17T12:00:00.000Z",
    results: [profile("Original complete profile")]
  });
  const repository = databaseApi.createMemoryRepository({ snapshots: [{ accountId: "account-1", runId: "baseline-run", promotedAt: "2026-11-17T12:00:00.000Z", source: "collected", document: baseline.document }] });
  const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: 1 }, minimumInterRequestDelayMs: 2500 };
  const auth = authorizationRecord(clock, {
    authorizationId: "44444444-4444-4444-8444-444444444444",
    runId: "55555555-5555-4555-8555-555555555555"
  });
  const job = runnerApi.createJob({ jobId: "job-partial", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId: "22222222-2222-4222-8222-222222222222", plan, now: new Date(clock).toISOString() });
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const runner = runnerApi.createSerialRunner({
    repository,
    nowMs: () => clock,
    registry: { adapters: [{
      section: "profile", version: "1", parserVersion: "1",
      collectStep: async () => ({ ok: true, accountId: "account-1", done: true, recordCount: 1, cumulativeRecordCount: 1, resultMode: "cumulative", parserResults: [profile("Partial replacement", "partial")] })
    }] },
    assembleDocument: assembleCanonical
  });

  const completion = await runner.tick(job.jobId);
  assert.equal(completion.ok, true, JSON.stringify(completion.job?.failure ?? completion));
  const promoted = (await repository.getSnapshot("account-1")).document;
  assert.equal(promoted.profile.displayName, "Original complete profile");
  assert.equal(promoted.account.localAccountId, localAccountId);
  assert.equal(promoted.sync.sectionOutcomes.profile.status, "complete");
  const promotedForValidation = JSON.parse(JSON.stringify(promoted));
  assert.equal(await accountDocumentApi.verifyIntegrity(promotedForValidation), true);
  accountDocumentApi.assertValid(promotedForValidation, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
});

test("runner stops before another adapter call at the global request bound", async () => {
  const clock = 60_000;
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: 1 }, minimumInterRequestDelayMs: 2500 };
  const auth = authorizationRecord(clock, {
    authorizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  });
  let called = false;
  const job = {
    ...runnerApi.createJob({ jobId: "job-requests", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(clock).toISOString() }),
    requestCount: runnerApi.MAXIMUM_REQUESTS_PER_JOB
  };
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const runner = runnerApi.createSerialRunner({
    repository,
    nowMs: () => clock,
    registry: { adapters: [{ section: "profile", collectStep: async () => { called = true; return {}; } }] },
    assembleDocument: assembleCanonical
  });

  assert.equal((await runner.tick(job.jobId)).ok, false);
  assert.equal(called, false);
  assert.equal((await repository.getJob(job.jobId)).failure.code, "REQUEST_LIMIT_EXCEEDED");
});

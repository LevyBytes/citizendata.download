import assert from "node:assert/strict";
import test from "node:test";
import { assembleCanonical, authorizationRecord, profile } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { accountDocumentApi, assemblerApi, databaseApi, localAccountId, runnerApi } from "./runner-under-test.mjs";

test("update reuse retains current canonical section data without parser replacement", async () => {
  const clock = Date.parse("2026-11-18T20:00:00.000Z");
  const prior = await assemblerApi.assemble({
    account: { localAccountId, ueeCitizenRecord: 42, handle: "Citizen" },
    exportedAt: "2026-11-18T19:00:00.000Z",
    generator: { name: "CitizenData", version: "0.42.1" },
    results: [profile("Original profile")],
    runs: []
  });
  const repository = databaseApi.createMemoryRepository({ snapshots: [{ accountId: "account-1", runId: "prior-run", document: prior.document }] });
  const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: 1 }, minimumInterRequestDelayMs: 900 };
  const auth = authorizationRecord(clock, { authorizationId: "abababab-abab-4bab-8bab-abababababab", runId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd" });
  const job = runnerApi.createJob({ jobId: "job-update-reuse", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, mode: "update", now: new Date(clock).toISOString() });
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  let observedPrevious;
  const runner = runnerApi.createSerialRunner({
    repository,
    nowMs: () => clock,
    random: () => 0,
    registry: { adapters: [{ section: "profile", version: "1.0.0", parserVersion: "1.0.0", collectStep: async (input) => {
      observedPrevious = input.previousSection;
      return {
        ok: true,
        accountId: "account-1",
        done: true,
        recordCount: 1,
        cumulativeRecordCount: 1,
        resultMode: "reuse",
        parserResults: [],
        reusedPrevious: true,
        changeState: "unchanged",
        requestActivities: [],
        requestProgress: { completed: 0, total: 0, totalKnown: false, subphase: null }
      };
    } }] },
    assembleDocument: assembleCanonical
  });

  assert.equal((await runner.tick(job.jobId)).ok, true);
  assert.equal(observedPrevious.current, true);
  assert.equal(observedPrevious.values.profile.displayName, "Original profile");
  const completed = await repository.getJob(job.jobId);
  assert.equal(completed.status, "complete");
  assert.equal(completed.httpRequestCount, 0);
  assert.equal(completed.updateSignals.profile, "unchanged");
  const promoted = (await repository.getSnapshot("account-1")).document;
  assert.equal(promoted.profile.displayName, "Original profile");
  assert.equal(promoted.sync.sectionOutcomes.profile.parserVersion, "1.0.0");
  assert.equal(await accountDocumentApi.verifyIntegrity(JSON.parse(JSON.stringify(promoted))), true);
});

test("runner rejects a cumulative record count above the authorized section cap before staging", async () => {
  const clock = 50_000;
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: 1 }, minimumInterRequestDelayMs: 2500 };
  const auth = authorizationRecord(clock, {
    authorizationId: "88888888-8888-4888-8888-888888888888",
    runId: "99999999-9999-4999-8999-999999999999"
  });
  const job = runnerApi.createJob({ jobId: "job-cap", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(clock).toISOString() });
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const runner = runnerApi.createSerialRunner({
    repository,
    nowMs: () => clock,
    registry: { adapters: [{ section: "profile", collectStep: async () => ({ ok: true, accountId: "account-1", done: true, recordCount: 2, cumulativeRecordCount: 2, resultMode: "cumulative", parserResults: [profile()] }) }] },
    assembleDocument: assembleCanonical
  });

  assert.equal((await runner.tick(job.jobId)).ok, false);
  assert.equal((await repository.getJob(job.jobId)).failure.code, "RECORD_CAP_EXCEEDED");
  assert.equal((await repository.getStagedRun(job.runId)).results.length, 0);
});

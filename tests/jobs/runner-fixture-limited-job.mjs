import { assembleCanonical, authorizationRecord, profile } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { databaseApi, localAccountId, runnerApi } from "./runner-under-test.mjs";

// A job that has already taken `requestsBySection.profile` steps of its one section and `requestCount` steps in all.
export async function limitedJob({ adapter, cap, requestCount, sectionSteps }) {
  const clock = 60_000;
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: cap }, minimumInterRequestDelayMs: 2500 };
  const auth = authorizationRecord(clock, { maximumRecordsBySection: { profile: cap } });
  const job = {
    ...runnerApi.createJob({ jobId: "job-limit", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(clock).toISOString() }),
    requestCount, requestsBySection: { profile: sectionSteps }
  };
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [] });
  let called = false;
  const runner = runnerApi.createSerialRunner({
    repository,
    nowMs: () => clock,
    registry: { adapters: [{
      section: "profile", ...adapter,
      collectStep: async () => { called = true; return { ok: true, accountId: "account-1", done: true, recordCount: 1, cumulativeRecordCount: 1, resultMode: "cumulative", parserResults: [profile()] }; }
    }] },
    assembleDocument: assembleCanonical
  });
  await runner.tick(job.jobId);
  return { called, failure: (await repository.getJob(job.jobId)).failure?.code ?? null };
}

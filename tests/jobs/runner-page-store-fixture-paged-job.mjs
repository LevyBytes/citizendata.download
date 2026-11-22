import { pagedAdapter } from "./runner-page-store-fixture-paged-adapter.mjs";
import { atBaseline, AUTHORIZATION_ID, authorizationRecord, databaseApi, plain, RUN_ID, runnerApi } from "./runner-page-store-loaded-with-fixture-authorization.mjs";

export async function pagedJob(script, { mode = "baseline", seed = {} } = {}) {
  const state = { clock: 50_000, log: [], snapshotReads: 0 };
  const memory = databaseApi.createMemoryRepository(seed);
  const repository = { ...memory, getSnapshot: async (key) => { state.snapshotReads += 1; return memory.getSnapshot(key); } };
  const plan = { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 500 }, minimumInterRequestDelayMs: 900 };
  const job = atBaseline(runnerApi.createJob({ jobId: "job-pages", runId: RUN_ID, accountId: "account-1", authorizationId: AUTHORIZATION_ID, localAccountId: "11111111-1111-4111-8111-111111111111", plan, mode, now: new Date(state.clock).toISOString() }));
  await repository.saveAuthorization(authorizationRecord(state.clock));
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [] });
  const adapter = pagedAdapter(script, state.log);
  // Each call is a worker that has just started: it knows nothing but what is stored.
  const startWorker = () => runnerApi.createSerialRunner({
    repository,
    registry: { adapters: [adapter] },
    nowMs: () => state.clock,
    random: () => 0,
    assembleDocument: async ({ staged }) => ({ document: { pledges: staged.results.find((result) => result.section === "pledges")?.value ?? null } })
  });
  const step = async (runner) => {
    const result = await runner.tick(job.jobId);
    state.clock += 1000;
    return result;
  };
  return { state, repository, job, startWorker, step, pages: () => plain([...memory.inspect().pages.values()]) };
}

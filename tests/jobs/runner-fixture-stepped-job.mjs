import { authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { atBaseline, databaseApi, localAccountId, runnerApi, sectionOutcome } from "./runner-under-test.mjs";

// A pledges job whose adapter returns one record per step for `steps` steps. `beforeRequest` runs inside each step,
// after the step announced its request, so a test can pause, resume, or cancel while the step is in flight.
export async function steppedJob({ steps = 3, beforeRequest = async () => {}, requestsPerStep = 1, onStatus, schedule } = {}) {
  const state = { clock: 50_000, calls: 0, requests: 0, inFlight: 0, maximumInFlight: 0, sleeps: [], events: [] };
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 50 }, minimumInterRequestDelayMs: 900 };
  const auth = authorizationRecord(
    state.clock,
    { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 50 }, parserVersions: { pledges: "1" }, expiresAt: new Date(state.clock + 3_600_000).toISOString(), idleTtlMs: 600_000, idleExpiresAt: new Date(state.clock + 600_000).toISOString() }
  );
  const job = atBaseline(runnerApi.createJob({ jobId: "job-loop", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(state.clock).toISOString() }));
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const adapter = {
    section: "pledges",
    version: "1",
    parserVersion: "1",
    collectStep: async (input) => {
      state.calls += 1;
      state.inFlight += 1;
      state.maximumInFlight = Math.max(state.maximumInFlight, state.inFlight);
      try {
        const call = state.calls;
        for (let request = 1; request <= requestsPerStep; request += 1) {
          await input.onRequestActivity({ kind: "request-started", method: "GET", route: "/fixed/pledges", page: call, pageCount: null, at: new Date(state.clock).toISOString() });
          state.requests += 1;
          await beforeRequest({ call, request, state });
        }
        const done = call >= steps;
        return {
          ok: true,
          accountId: "account-1",
          done,
          cursor: done ? null : { page: call + 1 },
          recordCount: 1,
          cumulativeRecordCount: call,
          resultMode: "cumulative",
          parserResults: [{ section: "pledges", value: Array.from({ length: call }, (_, index) => ({ recordKey: String(index) })), outcome: sectionOutcome(done ? "complete" : "partial", call) }]
        };
      } finally {
        state.inFlight -= 1;
      }
    }
  };
  const runner = runnerApi.createSerialRunner({
    repository,
    registry: { adapters: [adapter] },
    nowMs: () => state.clock,
    random: () => 0,
    // Time passes only when the loop waits, so the recorded waits are exactly the pacing the loop applied.
    sleep: async (milliseconds) => { state.sleeps.push(milliseconds); state.clock += milliseconds; },
    assembleDocument: async ({ staged }) => ({ document: { pledges: staged.results.find((result) => result.section === "pledges").value } }),
    schedule: async (scheduled) => schedule?.(scheduled, runner),
    onStatus: async (event) => { state.events.push(`${event.event}:${event.job.status}`); await onStatus?.(event, runner); }
  });
  return { runner, repository, job, auth, state };
}

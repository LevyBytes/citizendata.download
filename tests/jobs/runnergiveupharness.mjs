// A runner on a virtual clock with a scripted RSI, for the tests of the give-up, the run's lifetime and the Resume
// lease.
import { authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { databaseApi, localAccountId, runnerApi } from "./runner-under-test.mjs";

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const LIMIT = { kind: "limit", code: "RSI_HTML_HTTP_429", httpStatus: 429, rsiCode: null, rsiMessage: null, retryAfterMs: null, reason: null, method: "GET", route: "/account/pledges", page: 1, elapsedMs: 40, fromCanary: false };

// A pledges job whose adapter refuses while `state.refusing` holds, and otherwise stores a page. With `smartCheck`, the
// adapter has the smart check, which records when and for whom it was asked; the runner's in-step waits move the clock.
export async function harness({ expiresInMs = 6 * 3_600_000, idleTtlMs = 3_600_000, job: change = (value) => value, authorization: changeAuthorization = (value) => value, smartCheck = null } = {}) {
  const state = { clock: 2_000_000, refusing: true, requests: 0, refusedAt: null, smartChecks: [], sleeps: [] };
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 50 }, minimumInterRequestDelayMs: 900 };
  const auth = changeAuthorization(authorizationRecord(state.clock, { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 50 }, parserVersions: { pledges: "1" }, expiresAt: new Date(state.clock + expiresInMs).toISOString(), idleTtlMs,
    idleExpiresAt: new Date(state.clock + Math.min(idleTtlMs, expiresInMs)).toISOString() }));
  const job = change(runnerApi.createJob({ jobId: "job-stop", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(state.clock).toISOString() }));
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  let stored = 0;
  const adapter = {
    section: "pledges",
    version: "1",
    parserVersion: "1",
    collectStep: async (input) => {
      await input.onRequestActivity({ kind: "request-started", method: "GET", route: "/account/pledges", page: stored + 1, pageCount: null, at: new Date(state.clock).toISOString() });
      state.requests += 1;
      const line = (status) => ({ kind: "request-completed", method: "GET", route: "/account/pledges", page: stored + 1, pageCount: 9, responseStatus: status, recordsReceived: null, recordsTotal: null, elapsedMs: 40,
        at: new Date(state.clock).toISOString() });
      if (state.refusing) {
        state.refusedAt = state.clock;
        return { ok: false, code: "RSI_READ_FAILED", message: LIMIT.code, signal: LIMIT, requestActivities: [line(429)] };
      }
      stored += 1;
      return { ok: true, accountId: "account-1", done: false, cursor: { page: stored + 1 }, recordCount: 1, cumulativeRecordCount: stored, resultMode: "cumulative", page: { text: JSON.stringify({ step: stored }) }, parserResults: [],
        requestActivities: [line(200)] };
    },
    ...(smartCheck
      ? {
          smartCheck: async (input) => {
            state.smartChecks.push({ handle: input.handle, at: state.clock });
            if (input.beforeStatusRequest && !await input.beforeStatusRequest()) {
              return {
                probe: { probe: "failed", httpStatus: null },
                status: {
                  status: "unknown",
                  reason: "unreadable",
                  components: [],
                  httpStatus: null,
                  checkedAt: new Date(state.clock).toISOString()
                },
                diagnosis: null
              };
            }
            return smartCheck(state);
          }
        }
      : {})
  };
  const sleep = async (milliseconds) => {
    state.sleeps.push(milliseconds);
    state.clock += milliseconds;
  };
  const runner = runnerApi.createSerialRunner({ repository, registry: { adapters: [adapter] }, nowMs: () => state.clock, random: () => 0.5, sleep, assembleDocument: async () => ({ document: {} }) });
  // Ticks until the job stops or waits past `untilMs`, moving the clock to each wait's end.
  async function runUntilStopped(untilMs = Number.POSITIVE_INFINITY) {
    for (let index = 0; index < 200; index += 1) {
      const outcome = await runner.tick(job.jobId);
      const current = await repository.getJob(job.jobId);
      if (current.status !== "running") return current;
      const next = Date.parse(current.nextEligibleAt);
      if (next > untilMs) return current;
      state.clock = Math.max(state.clock, next);
      if (outcome.ok === false && !outcome.waiting) return current;
    }
    throw new Error("The run never stopped.");
  }
  return { state, repository, runner, job, auth, runUntilStopped };
}

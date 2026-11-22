// A runner whose run shows warnings, with a scripted status feed, for the tests of when the feed is read.
import { authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { databaseApi, localAccountId, pacingSettings, runnerApi } from "./runner-under-test.mjs";

export const LIMIT = { kind: "limit", code: "RSI_HTML_HTTP_429", httpStatus: 429, rsiCode: null, rsiMessage: null, retryAfterMs: null, reason: null, method: "GET", route: "/account/pledges", page: 1, elapsedMs: 40, fromCanary: false };

export const CACHE_MS = pacingSettings.smartCheck.statusPageCacheMs;

export const flush = () => new Promise((resolve) => setImmediate(resolve));

// A pledges job. Each request is refused while `state.refusing` holds, and otherwise answered in `state.elapsedMs`.
// The adapter's status check records when it was asked, and answers `state.feed()`.
export async function harness() {
  const state = { clock: 2_000_000, refusing: false, elapsedMs: 40, reads: [], feed: null };
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 500 }, minimumInterRequestDelayMs: 900 };
  const auth = authorizationRecord(state.clock, { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 500 }, parserVersions: { pledges: "1" }, expiresAt: new Date(state.clock + 6 * 3_600_000).toISOString(), idleTtlMs: 3_600_000,
    idleExpiresAt: new Date(state.clock + 3_600_000).toISOString() });
  const job = runnerApi.createJob({ jobId: "job-status", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(state.clock).toISOString() });
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  let stored = 0;
  const adapter = {
    section: "pledges",
    version: "1",
    parserVersion: "1",
    checkStatusPage: async ({ beforeRequest } = {}) => {
      if (beforeRequest && !await beforeRequest()) return { status: "unknown", reason: "unreadable", components: [], httpStatus: null, checkedAt: new Date(state.clock).toISOString() };
      state.reads.push(state.clock);
      return state.feed ? state.feed() : { status: "issue", reason: null, components: [{ name: "Platform", state: "degraded performance" }], httpStatus: 200, checkedAt: new Date(state.clock).toISOString() };
    },
    collectStep: async (input) => {
      await input.onRequestActivity({ kind: "request-started", method: "GET", route: "/account/pledges", page: stored + 1, pageCount: null, at: new Date(state.clock).toISOString() });
      const line = (status) => ({ kind: "request-completed", method: "GET", route: "/account/pledges", page: stored + 1, pageCount: 400, responseStatus: status, recordsReceived: null, recordsTotal: null, elapsedMs: state.elapsedMs,
        at: new Date(state.clock).toISOString() });
      if (state.refusing) return { ok: false, code: "RSI_READ_FAILED", message: LIMIT.code, signal: LIMIT, requestActivities: [line(429)] };
      stored += 1;
      return { ok: true, accountId: "account-1", done: false, cursor: { page: stored + 1 }, recordCount: 1, cumulativeRecordCount: stored, resultMode: "cumulative", page: { text: JSON.stringify({ step: stored }) }, parserResults: [],
        requestActivities: [line(200)] };
    }
  };
  const runner = runnerApi.createSerialRunner({ repository, registry: { adapters: [adapter] }, nowMs: () => state.clock, random: () => 0.5, assembleDocument: async () => ({ document: {} }) });
  // One tick, the status read's merge given its turn, then the clock moved to the job's next time.
  async function tick() {
    await runner.tick(job.jobId);
    await flush();
    const current = await repository.getJob(job.jobId);
    state.clock = Math.max(state.clock, Date.parse(current.nextEligibleAt));
    return current;
  }
  return { state, repository, tick, job };
}

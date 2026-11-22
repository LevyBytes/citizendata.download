// A pledges job whose adapter answers from a script, for the runner's refused-step and stored-state tests
// (PARSER_HARDENING.md R6, §7.4, §7.6, §7.7, §7.13).
import { authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { databaseApi, localAccountId, runnerApi, sectionOutcome } from "./runner-under-test.mjs";

export const plain = (value) => JSON.parse(JSON.stringify(value));
export const signal = (kind, code, extra = {}) => ({ kind, code, httpStatus: null, rsiCode: null, rsiMessage: null, retryAfterMs: null, reason: null, method: "GET", route: "/account/pledges", page: 1, elapsedMs: 40, fromCanary: false, ...extra });
export const LIMIT = signal("limit", "RSI_HTML_HTTP_429", { httpStatus: 429 });
export const TIMEOUT = signal("transient", "RSI_REQUEST_TIMEOUT");
export const UNCLEAR = signal("ambiguous", "RSI_HTML_HTTP_403", { httpStatus: 403 });

// A pledges job whose adapter answers from `script`: a signal refuses the step, `true` stores one page of one record.
export async function scripted(script, { start = (job) => job } = {}) {
  const state = { clock: 1_000_000, inputs: [], during: null };
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 50 }, minimumInterRequestDelayMs: 900 };
  const auth = authorizationRecord(state.clock, { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 50 }, parserVersions: { pledges: "1" }, expiresAt: new Date(state.clock + 6 * 3_600_000).toISOString(), idleTtlMs: 3_600_000,
    idleExpiresAt: new Date(state.clock + 3_600_000).toISOString() });
  const job = start(runnerApi.createJob({ jobId: "job-refused", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(state.clock).toISOString() }));
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  let stored = 0;
  const adapter = {
    section: "pledges",
    version: "1",
    parserVersion: "1",
    collectStep: async (input) => {
      state.inputs.push({ cursor: plain(input.cursor ?? null), canary: input.canary, canaryAfterSignal: plain(input.canaryAfterSignal ?? null), lanes: input.lanes });
      await input.onRequestActivity({ kind: "request-started", method: "GET", route: "/account/pledges", page: stored + 1, pageCount: null, at: new Date(state.clock).toISOString() });
      if (state.during) await state.during();
      const answer = script.shift();
      const line = (status) => ({ kind: "request-completed", method: "GET", route: "/account/pledges", page: stored + 1, pageCount: 3, responseStatus: status, recordsReceived: null, recordsTotal: null, elapsedMs: 40,
        at: new Date(state.clock).toISOString() });
      if (answer !== true) return { ok: false, code: "RSI_READ_FAILED", message: answer.code, signal: answer, requestActivities: [line(answer.httpStatus ?? 500)] };
      stored += 1;
      const done = stored >= 3;
      return {
        ok: true, accountId: "account-1", done, cursor: done ? null : { page: stored + 1 }, recordCount: 1, cumulativeRecordCount: stored, resultMode: "cumulative",
        page: done ? null : { text: JSON.stringify({ step: stored }) },
        parserResults: done ? [{ section: "pledges", value: [{ recordKey: "1" }, { recordKey: "2" }, { recordKey: "3" }], outcome: sectionOutcome("complete", 3) }] : [],
        requestActivities: [line(200)]
      };
    }
  };
  const runner = runnerApi.createSerialRunner({ repository, registry: { adapters: [adapter] }, nowMs: () => state.clock, random: () => 0.5, assembleDocument: async ({ job: completed }) => ({ document: { completed: completed.runId } }) });
  return { state, repository, runner, job };
}

// A job of several sections whose adapters answer from a script (PARSER_HARDENING.md §10): `true` finishes the section in
// one step, a signal refuses it. A contract answer carries a privacy-safe finding, as rsi-api.js leaves one.
import { authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { databaseApi, localAccountId, runnerApi, sectionOutcome } from "./runner-under-test.mjs";

export const plain = (value) => JSON.parse(JSON.stringify(value));
export const signal = (kind, code, extra = {}) => ({ kind, code, httpStatus: null, rsiCode: null, rsiMessage: null, retryAfterMs: null, reason: null, method: "GET", route: "/account/pledges", page: 1, elapsedMs: 40, fromCanary: false, ...extra });
export const CHANGED = signal("contract", "RSI_PAGE_CONTRACT_CHANGED", { httpStatus: 410 });
export const LIMIT = signal("limit", "RSI_HTML_HTTP_429", { httpStatus: 429 });
export const TERMINAL = new Set(["complete", "partial", "failed", "cancelled"]);

// The sections that read others, as the catalog names them.
const INPUTS = { buybackDetails: ["buybacks"], buybackUpgradePrices: ["buybacks", "pledges"] };

export function findingFor(section, code) {
  const key = [...`${section}:${code}`].map((character) => character.codePointAt(0).toString(16)).join("").padEnd(64, "0").slice(0, 64);
  return { findingKey: key, section, code, method: "GET", route: "/account/pledges", page: 1, httpStatus: 410, contentType: "text/html", byteLength: 10, bodySha256: null, bodyTruncated: false, finalRoute: null, pageMarkers: {}, topLevelKeys: [],
    operationNames: [], observedAt: "2026-11-21T00:00:00.000Z", sourceUrls: [] };
}

export async function contractRun(sections, script = {}, { mode = "baseline", saved = null } = {}) {
  const state = { clock: 1_000_000, calls: [], events: [] };
  const repository = databaseApi.createMemoryRepository();
  const maximumRecordsBySection = Object.fromEntries(sections.map((section) => [section, 50]));
  const plan = { selectedSections: sections, maximumRecordsBySection, minimumInterRequestDelayMs: 900 };
  const auth = authorizationRecord(state.clock, { selectedSections: sections, maximumRecordsBySection, parserVersions: Object.fromEntries(sections.map((section) => [section, "1"])), expiresAt: new Date(state.clock + 6 * 3_600_000).toISOString(),
    idleTtlMs: 3_600_000, idleExpiresAt: new Date(state.clock + 3_600_000).toISOString() });
  const job = runnerApi.createJob({ jobId: "job-contract", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, mode, now: new Date(state.clock).toISOString() });
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  if (saved) await repository.saveSnapshot({ accountId: job.accountId, runId: "44444444-4444-4444-8444-444444444444", promotedAt: new Date(state.clock - 86_400_000).toISOString(), source: "collected", document: saved });
  const adapters = sections.map((section) => ({
    section,
    version: "1",
    parserVersion: "1",
    ...(INPUTS[section] ? { inputs: INPUTS[section] } : {}),
    collectStep: async (input) => {
      state.calls.push({ section, at: state.clock, canary: input.canary, inputs: plain(input.sectionInputs ?? null) });
      await input.onRequestActivity({ kind: "request-started", method: "GET", route: "/account/pledges", page: 1, pageCount: null, at: new Date(state.clock).toISOString() });
      const answer = (script[section] ?? []).shift() ?? true;
      const line = (status) => ({ kind: "request-completed", method: "GET", route: "/account/pledges", page: 1, pageCount: 1, responseStatus: status, recordsReceived: null, recordsTotal: null, elapsedMs: 40, at: new Date(state.clock).toISOString() });
      if (answer !== true) {
        return { ok: false, code: "RSI_READ_FAILED", message: answer.code, signal: answer, requestActivities: [line(answer.httpStatus ?? 500)], contractFinding: answer.kind === "contract" ? findingFor(section, answer.code) : null };
      }
      return {
        ok: true, accountId: "account-1", done: true, cursor: null, recordCount: 0, cumulativeRecordCount: 0, resultMode: "cumulative",
        parserResults: [{ section, value: [], outcome: sectionOutcome("complete", 0) }],
        requestActivities: [line(200)]
      };
    }
  }));
  const runner = runnerApi.createSerialRunner({
    repository,
    registry: { adapters },
    nowMs: () => state.clock,
    random: () => 0.5,
    sleep: async (milliseconds) => { state.clock += milliseconds; },
    onStatus: async (event) => { state.events.push(event.event); },
    assembleDocument: async ({ job: completed }) => ({ document: { completed: completed.runId } })
  });
  // Steps the job until it ends or `steps` ticks have passed, moving the clock to each next eligible time.
  async function drive(steps = 60, until = null) {
    for (let index = 0; index < steps; index += 1) {
      const current = await repository.getJob(job.jobId);
      if (TERMINAL.has(current.status) || current.status !== "running" || until?.(current)) return current;
      const outcome = await runner.tick(job.jobId);
      if (outcome.waiting) state.clock = outcome.eligibleAt;
      else {
        const next = await repository.getJob(job.jobId);
        if (next.status === "running") state.clock = Math.max(state.clock, Date.parse(next.nextEligibleAt));
      }
    }
    return repository.getJob(job.jobId);
  }
  return { state, repository, runner, job, auth, drive };
}

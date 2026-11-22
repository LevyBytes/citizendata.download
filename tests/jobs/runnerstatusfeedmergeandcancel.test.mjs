// Status feed results that land during a run (PARSER_HARDENING.md §7.5, §12.10, R15): a merge that lands while the
// runner holds an older copy of the job is kept by the runner's write, no activity number is used twice, and a
// result that arrives after a cancel stays only in the cache.
import assert from "node:assert/strict";
import test from "node:test";
import { authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { databaseApi, runnerApi } from "./runner-under-test.mjs";
import { plain, flush, statusHost, checkerOf, storedJob } from "./runnerstatusfeedcache.mjs";

const LIMIT = { kind: "limit", code: "RSI_HTML_HTTP_429", httpStatus: 429, rsiCode: null, rsiMessage: null, retryAfterMs: null, reason: null, method: "GET", route: "/account/pledges", page: 1, elapsedMs: 40, fromCanary: false };

// A pledges run whose adapter refuses while `state.refusing` holds, and whose status check is held until released.
async function runnerHarness() {
  const state = { clock: 2_000_000, refusing: false, during: null };
  const repository = databaseApi.createMemoryRepository();
  const job = await storedJob(repository, { warning: null });
  const auth = authorizationRecord(state.clock, { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 500 }, parserVersions: { pledges: "1" }, expiresAt: new Date(state.clock + 6 * 3_600_000).toISOString(), idleTtlMs: 3_600_000,
    idleExpiresAt: new Date(state.clock + 3_600_000).toISOString() });
  await repository.saveAuthorization({ ...auth, runId: job.runId, authorizationId: job.authorizationId });
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const clock = { now: Date.parse("2026-11-21T12:00:00Z") };
  const host = statusHost("issue-unresolved", { held: true });
  const checker = checkerOf(repository, host, clock);
  let stored = 0;
  const adapter = {
    section: "pledges",
    version: "1",
    parserVersion: "1",
    checkStatusPage: (options) => checker.checkStatusPage(options),
    collectStep: async (input) => {
      await input.onRequestActivity({ kind: "request-started", method: "GET", route: "/account/pledges", page: stored + 1, pageCount: null, at: new Date(state.clock).toISOString() });
      if (state.during) await state.during();
      const line = (status) => ({ kind: "request-completed", method: "GET", route: "/account/pledges", page: stored + 1, pageCount: 400, responseStatus: status, recordsReceived: null, recordsTotal: null, elapsedMs: 40,
        at: new Date(state.clock).toISOString() });
      if (state.refusing) return { ok: false, code: "RSI_READ_FAILED", message: LIMIT.code, signal: LIMIT, requestActivities: [line(429)] };
      stored += 1;
      return { ok: true, accountId: "account-1", done: false, cursor: { page: stored + 1 }, recordCount: 1, cumulativeRecordCount: stored, resultMode: "cumulative", page: { text: JSON.stringify({ step: stored }) }, parserResults: [],
        requestActivities: [line(200)] };
    }
  };
  const runner = runnerApi.createSerialRunner({ repository, registry: { adapters: [adapter] }, nowMs: () => state.clock, random: () => 0.5, assembleDocument: async () => ({ document: {} }) });
  async function tick() {
    await runner.tick(job.jobId);
    await flush();
    const current = await repository.getJob(job.jobId);
    state.clock = Math.max(state.clock, Date.parse(current.nextEligibleAt));
    return current;
  }
  return { state, repository, runner, host, job, tick };
}

test("a merge that lands while the runner holds an older copy is kept by its write; no activity number is used twice", async () => {
  const { state, repository, host, tick } = await runnerHarness();
  await tick();
  state.refusing = true;
  const refused = await tick();
  assert.equal(host.requests.length, 1, "the warning started a read, which is held");
  assert.equal(refused.pace.statusPage, null);
  // The next attempt's copy is read; the feed answers while its request is in flight.
  state.during = async () => {
    state.during = null;
    host.release();
    for (let index = 0; index < 5; index += 1) await flush();
    assert.equal((await repository.getJob(refused.jobId)).pace.statusPage.status, "issue", "merged meanwhile");
  };
  const written = plain(await tick());
  assert.equal(written.pace.statusPage.status, "issue", "the runner's write kept the merged result");
  assert.deepEqual(written.pace.statusPage.components, [{ name: "Persistent Universe", state: "unresolved issue" }], "an unresolved issue names its component");
  const seqs = written.activityLog.map((line) => line.seq);
  assert.deepEqual(seqs, [...new Set(seqs)].sort((left, right) => left - right), `seqs ${seqs}`);
  assert.equal(written.activitySequence, seqs.at(-1));
  const smartCheck = written.activityLog.find((line) => line.kind === "smart-check");
  assert.deepEqual([smartCheck.check, smartCheck.outcome], ["status-page", "issue"]);
  assert.ok(written.activityLog.filter((line) => line.seq > smartCheck.seq).length > 0, "the attempt's own lines come after it");
  // The stored status page passes the pace's own validation: the run goes on.
  state.refusing = false;
  const next = await tick();
  assert.equal(next.status, "running", next.failure?.code);
  assert.equal(host.requests.length, 1);
});

test("a result that arrives after a cancel stays only in the cache; the cancelled job is untouched", async () => {
  const { state, repository, runner, host, job, tick } = await runnerHarness();
  await tick();
  state.refusing = true;
  await tick();
  assert.equal(host.requests.length, 1);
  await runner.cancel(job.jobId);
  const cancelled = plain(await repository.getJob(job.jobId));
  host.release();
  for (let index = 0; index < 5; index += 1) await flush();
  assert.deepEqual(plain(await repository.getJob(job.jobId)), cancelled);
  assert.equal(cancelled.status, "cancelled");
  const cached = plain(await repository.getStatusFeedCache());
  assert.deepEqual([cached.status, cached.components], ["issue", [{ name: "Persistent Universe", state: "unresolved issue" }]]);
});

// A changed page soon after a refusal, and the end of a run with a section set aside (PARSER_HARDENING.md §10.1,
// §10.3): within the quiet period nothing more is asked of the section until its end, then one canary and one recheck
// decide; a canary refusal returns to the ordinary brake, and a normal answer is read as usual. A run that set a
// section aside ends partial: no promotion, a partial run receipt with its pacing, its staged result kept for the
// dashboard, and its authorization used.
import assert from "node:assert/strict";
import test from "node:test";
import { CHANGED, LIMIT, contractRun, plain, signal } from "./runner-fixture-contract-sections.mjs";
import { pacingSettings } from "./runner-under-test.mjs";

const QUIET_MS = pacingSettings.setAside.quietMs;

// Runs until the pledges section has a change waiting for its recheck.
async function pendingAfterRefusal(pledges) {
  const run = await contractRun(["profile", "pledges", "hangarLog"], { pledges });
  const pending = await run.drive(60, (job) => job.pendingContract);
  return { ...run, pending };
}

test("a change soon after a refusal waits out the quiet period, then one canary and one recheck set the section aside", async () => {
  const { state, repository, job, runner, pending, drive } = await pendingAfterRefusal([LIMIT, CHANGED, CHANGED]);
  const refusalAt = Date.parse(pending.pace.lastRefusalAt);
  assert.deepEqual(plain(pending.pendingContract).section, "pledges");
  assert.equal(pending.pendingContract.recheckAt, new Date(refusalAt + QUIET_MS).toISOString());
  assert.equal(pending.nextEligibleAt, pending.pendingContract.recheckAt);
  assert.equal(pending.pace.canaryDue, true);
  assert.equal(pending.pendingContract.finding.section, "pledges");
  assert.deepEqual(plain(pending.setAsideSections ?? []), []);
  // Nothing is asked of the section before the end of the quiet period.
  const asked = state.calls.length;
  state.clock = Date.parse(pending.pendingContract.recheckAt) - 1;
  assert.equal((await runner.tick(job.jobId)).waiting, true);
  assert.equal(state.calls.length, asked);
  const ended = await drive();
  const recheck = state.calls.filter((call) => call.section === "pledges").at(-1);
  assert.deepEqual([recheck.canary, recheck.at >= Date.parse(pending.pendingContract.recheckAt)], [true, true]);
  assert.equal(state.calls.filter((call) => call.section === "pledges").length, 3);
  assert.equal(ended.status, "partial");
  assert.equal(ended.pendingContract, null);
  assert.deepEqual(plain(ended.setAsideSections).map((entry) => entry.section), ["pledges"]);
  assert.ok(state.calls.some((call) => call.section === "hangarLog"));
  assert.equal(plain((await repository.getStagedRun(job.runId)).contractFindings).length, 1);
});

test("a canary refusal at the recheck returns to the ordinary brake, and a later normal answer is read as usual", async () => {
  const { state, pending, drive } = await pendingAfterRefusal([LIMIT, CHANGED, signal("limit", "RSI_HTML_HTTP_429", { httpStatus: 429, fromCanary: true }), true]);
  assert.ok(pending.pendingContract);
  const braked = await drive(60, (job) => job.pendingContract === null);
  assert.equal(braked.status, "running");
  assert.equal(braked.pace.attempt > 0, true, "the canary's refusal is an ordinary refusal");
  const ended = await drive();
  assert.equal(ended.status, "complete");
  assert.deepEqual(plain(ended.setAsideSections ?? []), []);
  assert.equal(state.calls.filter((call) => call.section === "pledges").length, 4);
});

test("a section that answers normally at the recheck is read as usual", async () => {
  const { pending, drive } = await pendingAfterRefusal([LIMIT, CHANGED, true]);
  assert.ok(pending.pendingContract);
  const ended = await drive();
  assert.deepEqual([ended.status, ended.pendingContract, plain(ended.setAsideSections ?? [])], ["complete", null, []]);
});

test("a run resumed during the quiet period still waits for the recheck", async () => {
  const { state, runner, job, pending, repository } = await pendingAfterRefusal([LIMIT, CHANGED, CHANGED]);
  await runner.pause(job.jobId);
  state.clock += 1_000;
  await runner.resume(job.jobId);
  const resumed = await repository.getJob(job.jobId);
  assert.equal(resumed.status, "running");
  assert.ok(Date.parse(resumed.nextEligibleAt) >= Date.parse(pending.pendingContract.recheckAt));
});

test("a run with a section set aside ends partial: nothing is promoted, its receipt says partial with its pacing, and its result waits", async () => {
  const saved = { previous: true, sync: { sectionOutcomes: {} } };
  const { state, repository, job, auth, drive } = await contractRun(["profile", "pledges"], { pledges: [CHANGED] }, { mode: "update", saved });
  const ended = await drive();
  assert.equal(ended.status, "partial");
  assert.equal(state.events.at(-1), "partial");
  assert.ok(!state.events.includes("complete"), "it is never announced as complete");
  // The saved backup stays the base of the next update.
  assert.deepEqual(plain((await repository.getSnapshot(job.accountId)).document), saved);
  // The staged run keeps its results for the partial document, with a partial receipt and its pacing summary.
  const staged = await repository.getStagedRun(job.runId);
  assert.equal(staged.status, "partial");
  assert.deepEqual(plain(staged.results).map((result) => result.section), ["profile"]);
  assert.equal(staged.runReceipt.status, "partial");
  assert.deepEqual(Object.keys(staged.runReceipt.pacing).sort(), ["acceptedRequests", "controllerVersion", "finalFactor", "maximumFactor", "refusedRequests", "retriedRequests", "settingsFingerprint", "settingsVersion", "signalCounts", "slowSteps",
    "startedFactor"]);
  assert.match(staged.runReceipt.pacing.settingsFingerprint, /^[0-9a-f]{64}$/u);
  assert.ok(plain(staged.runReceipt.pacing.signalCounts).some((bucket) => bucket.section === "pledges" && bucket.kind === "contract"));
  // The run's pages are gone and its authorization is used.
  assert.deepEqual(plain(await repository.listPages(job.collectionId)), []);
  assert.ok((await repository.getAuthorization(auth.authorizationId)).consumedAt);
});

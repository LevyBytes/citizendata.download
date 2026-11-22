import assert from "node:assert/strict";
import test from "node:test";
import { assembleCanonical, profile } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { accountDocumentApi, atBaseline, authorizationApi, databaseApi, localAccountId, runnerApi, sectionOutcome } from "./runner-under-test.mjs";

test("serial runner honors pacing, executes one adapter step at a time, and atomically promotes", async () => {
  let clock = 10_000;
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["profile", "pledges"], maximumRecordsBySection: { profile: 1, pledges: 10 }, minimumInterRequestDelayMs: 900 };
  const proposal = authorizationApi.createProposal({ proposalId: "proposal-1234567890", plan, dashboardOrigin: "https://citizendata.download", dashboardPath: "/", bridgeSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nowMs: clock, ttlMs: 60_000 });
  const authorization = authorizationApi.createAuthorization(
    proposal,
    { authorizationId: "22222222-2222-4222-8222-222222222222", runId: "33333333-3333-4333-8333-333333333333", accountId: "account-1", localAccountId, planHash: "a".repeat(64), extensionVersion: "0.1.0", permissionGranted: true, nowMs: clock }
  ).value;
  const calls = [];
  const staggerValues = [];
  const adapters = plan.selectedSections.map((section) => ({
    section,
    version: "1",
    parserVersion: "1",
    collectStep: async (input) => {
      calls.push(section);
      staggerValues.push(input.concurrentRequestStaggerMs);
      await input.onRequestActivity({ kind: "request-started", method: "GET", route: `/fixed/${section}`, page: 1, pageCount: null, at: new Date(clock).toISOString() });
      const parserResults = section === "profile"
        ? [profile()]
        : [{ section: "pledges", value: [], outcome: sectionOutcome("complete", 0) }];
      return {
        ok: true, done: true, accountId: "account-1", recordCount: parserResults[0].outcome.records, cumulativeRecordCount: parserResults[0].outcome.records,
        resultMode: "cumulative", parserResults,
        requestActivities: [{ kind: "request-completed", method: "GET", route: `/fixed/${section}`, page: 1, pageCount: 1, responseStatus: 200, recordsReceived: parserResults[0].outcome.records, elapsedMs: 5, at: new Date(clock).toISOString() }],
        requestProgress: { completed: 1, total: 1, totalKnown: true, subphase: null }, documentPatch: { shouldNeverPromote: true }
      };
    }
  }));
  const schedules = [];
  const runner = runnerApi.createSerialRunner({ repository, registry: { adapters }, nowMs: () => clock, random: () => 1, assembleDocument: assembleCanonical, schedule: async (_job, when) => schedules.push(when) });
  const job = atBaseline(runnerApi.createJob({ jobId: "job-1", runId: authorization.runId, accountId: authorization.accountId, authorizationId: authorization.authorizationId, localAccountId, plan, now: new Date(clock).toISOString() }));
  await repository.saveAuthorization(authorization);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });

  assert.equal((await runner.tick(job.jobId)).ok, true);
  assert.deepEqual(calls, ["profile"]);
  assert.deepEqual(staggerValues, [550]);
  const firstProgress = await repository.getJob(job.jobId);
  assert.equal(firstProgress.httpRequestCount, 1);
  assert.equal(firstProgress.httpRequestsBySection.profile, 1);
  assert.equal(firstProgress.requestTotalsBySection.profile, 1);
  assert.equal(firstProgress.resolvedRequestTotalsForSections, 1);
  assert.equal(firstProgress.httpRequestsTotal, null);
  assert.deepEqual(JSON.parse(JSON.stringify(firstProgress.requestProgressBySection.profile)), { completed: 1, total: 1, totalKnown: true, subphase: null });
  assert.deepEqual([...firstProgress.activityLog].map((activity) => activity.kind), ["section-started", "request-started", "request-completed", "section-completed"]);
  assert.equal(Date.parse((await repository.getJob(job.jobId)).nextEligibleAt), clock + 1100);
  // A step never asks the host to schedule the next one; the loop that called it waits out the pacing delay itself.
  assert.deepEqual(schedules, []);
  assert.deepEqual({ ...await runner.tick(job.jobId) }, { ok: true, waiting: true, eligibleAt: clock + 1100 });
  assert.deepEqual(calls, ["profile"]);
  clock += 1100;
  const completion = await runner.tick(job.jobId);
  assert.equal(completion.ok, true, JSON.stringify(completion.job?.failure ?? completion));
  assert.deepEqual(calls, ["profile", "pledges"]);
  assert.deepEqual(staggerValues, [550, 550]);
  assert.equal((await repository.getJob(job.jobId)).status, "complete");
  assert.equal((await repository.getJob(job.jobId)).httpRequestCount, 2);
  assert.equal((await repository.getJob(job.jobId)).resolvedRequestTotalsForSections, 2);
  assert.equal((await repository.getJob(job.jobId)).httpRequestsTotal, 2);
  const promoted = (await repository.getSnapshot("account-1")).document;
  assert.equal(promoted.profile.displayName, "Citizen");
  assert.equal(promoted.pledges.length, 0);
  assert.equal(promoted.shouldNeverPromote, undefined);
  assert.equal(promoted.sync.sectionOutcomes.profile.status, "complete");
  assert.equal(promoted.sync.sectionOutcomes.pledges.status, "complete");
  assert.equal(promoted.sync.runs.length, 1);
  assert.equal(promoted.sync.runs[0].authorization.planHash, "a".repeat(64));
  const promotedForValidation = JSON.parse(JSON.stringify(promoted));
  assert.equal(await accountDocumentApi.verifyIntegrity(promotedForValidation), true);
  accountDocumentApi.assertValid(promotedForValidation, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
  assert.ok((await repository.getAuthorization(authorization.authorizationId)).consumedAt);
  assert.deepEqual(schedules, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { authorizationApi, databaseApi, localAccountId, runnerApi, sectionOutcome } from "./runner-under-test.mjs";

test("paced runner renews its bounded idle lease after proposal expiry and stops when activity expires", async () => {
  let clock = 1_000;
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 3 }, minimumInterRequestDelayMs: 2500 };
  const proposal = authorizationApi.createProposal({
    proposalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    plan,
    dashboardOrigin: "https://citizendata.download",
    dashboardPath: "/",
    bridgeSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    parserVersions: { pledges: "1" },
    nowMs: clock,
    ttlMs: 1_000
  });
  const auth = authorizationApi.createAuthorization(proposal, {
    authorizationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    runId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    accountId: "account-1",
    localAccountId,
    planHash: "b".repeat(64),
    extensionVersion: "0.1.0",
    permissionGranted: true,
    runTtlMs: 60_000,
    idleTtlMs: 10_000,
    nowMs: clock
  }).value;
  let calls = 0;
  const adapter = {
    section: "pledges",
    version: "1",
    parserVersion: "1",
    collectStep: async () => {
      calls += 1;
      return {
        ok: true,
        accountId: "account-1",
        done: false,
        cursor: { page: calls + 1 },
        recordCount: 1,
        cumulativeRecordCount: calls,
        resultMode: "cumulative",
        parserResults: [{ section: "pledges", value: Array.from({ length: calls }, (_, index) => ({ recordKey: String(index) })), outcome: sectionOutcome("partial", calls) }]
      };
    }
  };
  const job = runnerApi.createJob({ jobId: "job-paced", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(clock).toISOString() });
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const runner = runnerApi.createSerialRunner({ repository, registry: { adapters: [adapter] }, nowMs: () => clock, random: () => 0 });

  assert.equal((await runner.tick(job.jobId)).ok, true);
  clock = 10_500;
  assert.equal(authorizationApi.proposalIsCurrent(proposal, clock), false);
  assert.equal((await runner.tick(job.jobId)).ok, true);
  assert.equal(calls, 2);
  const renewed = await repository.getAuthorization(auth.authorizationId);
  assert.equal(Date.parse(renewed.idleExpiresAt), 20_500);

  clock = 20_501;
  assert.equal((await runner.tick(job.jobId)).ok, false);
  assert.equal((await repository.getJob(job.jobId)).failure.code, "AUTHORIZATION_IDLE_EXPIRED");
  assert.equal(calls, 2);
});

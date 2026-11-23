import assert from "node:assert/strict";
import test from "node:test";
import { assembleCanonical, authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { limitedJob } from "./runner-fixture-limited-job.mjs";
import { databaseApi, localAccountId, runnerApi, sectionOutcome } from "./runner-under-test.mjs";

test("a section that reads a fixed number of records a step is bounded by its record cap", async () => {
  // Two records a step under a cap of 6000 records: 3000 steps and a margin of 8, more than the fixed section limit.
  const paged = { recordsPerStep: 2 };
  const limit = 6000 / 2 + 8;
  assert.ok(limit > runnerApi.MAXIMUM_REQUESTS_PER_SECTION);
  assert.deepEqual(await limitedJob({ adapter: paged, cap: 6000, requestCount: limit - 1, sectionSteps: limit - 1 }), { called: true, failure: null });
  assert.deepEqual(await limitedJob({ adapter: paged, cap: 6000, requestCount: limit, sectionSteps: limit }), { called: false, failure: "REQUEST_LIMIT_EXCEEDED" });
  // The job's own limit grows by the same number of steps, and by no more.
  const jobLimit = runnerApi.MAXIMUM_REQUESTS_PER_JOB + limit;
  assert.deepEqual(await limitedJob({ adapter: paged, cap: 6000, requestCount: jobLimit - 1, sectionSteps: 0 }), { called: true, failure: null });
  assert.deepEqual(await limitedJob({ adapter: paged, cap: 6000, requestCount: jobLimit, sectionSteps: 0 }), { called: false, failure: "REQUEST_LIMIT_EXCEEDED" });
  // A section that declares nothing keeps the fixed limits.
  assert.deepEqual(await limitedJob({ adapter: {}, cap: 6000, requestCount: 0, sectionSteps: runnerApi.MAXIMUM_REQUESTS_PER_SECTION }), { called: false, failure: "REQUEST_LIMIT_EXCEEDED" });
  assert.deepEqual(await limitedJob({ adapter: {}, cap: 6000, requestCount: runnerApi.MAXIMUM_REQUESTS_PER_JOB, sectionSteps: 0 }), { called: false, failure: "REQUEST_LIMIT_EXCEEDED" });
});

test("a section is handed the finished sections it reads: this run's result, or else the saved backup's", async () => {
  const clock = 60_000;
  const run = async ({ staged, saved, mode = "baseline" }) => {
    const repository = databaseApi.createMemoryRepository(saved ? { snapshots: [{ snapshotKey: "account-1", accountId: "account-1", runId: "earlier", source: "collected", document: saved }] } : {});
    const plan = { selectedSections: ["profile"], maximumRecordsBySection: { profile: 1 }, minimumInterRequestDelayMs: 2500 };
    const auth = authorizationRecord(clock);
    const job = runnerApi.createJob({ jobId: "job-inputs", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, mode, now: new Date(clock).toISOString() });
    await repository.saveAuthorization(auth);
    await repository.saveJob(job);
    await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: staged, checkpoints: [] });
    let seen = null;
    const runner = runnerApi.createSerialRunner({
      repository,
      nowMs: () => clock,
      registry: { adapters: [{
        section: "profile", version: "1.0.0", inputs: ["buybacks", "pledges"], carriesForward: true,
        collectStep: async (input) => { seen = JSON.parse(JSON.stringify({ inputs: input.sectionInputs, previous: input.previousSection })); return { ok: false, code: "STOP", message: "Enough was seen." }; }
      }] },
      assembleDocument: assembleCanonical
    });
    await runner.tick(job.jobId);
    return seen;
  };
  const savedDocument = { buybacks: [{ buybackId: 1 }], pledges: [{ pledgeId: 9 }], profile: { handle: "Saved" }, sync: { sectionOutcomes: { profile: sectionOutcome() } } };
  const stagedBuybacks = { section: "buybacks", value: [{ buybackId: 2 }], outcome: sectionOutcome() };
  // This run's finished list is used; a section this run did not read comes from the saved backup.
  assert.deepEqual((await run({ staged: [stagedBuybacks], saved: savedDocument })).inputs, { buybacks: [{ buybackId: 2 }], pledges: [{ pledgeId: 9 }] });
  // A result that is not complete is not an input.
  assert.deepEqual((await run({ staged: [{ ...stagedBuybacks, outcome: sectionOutcome("partial") }], saved: savedDocument })).inputs, { buybacks: [{ buybackId: 1 }], pledges: [{ pledgeId: 9 }] });
  assert.deepEqual((await run({ staged: [], saved: null })).inputs, { buybacks: null, pledges: null });
  // A section that carries its records forward is given the saved section in every kind of run, not only an update.
  const previous = (await run({ staged: [], saved: savedDocument, mode: "continuation" })).previous;
  assert.deepEqual([previous.current, previous.values.profile, previous.recordCount], [true, { handle: "Saved" }, 1]);
});

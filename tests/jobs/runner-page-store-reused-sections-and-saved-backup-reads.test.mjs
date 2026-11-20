import assert from "node:assert/strict";
import test from "node:test";
import { pagedJob } from "./runner-page-store-fixture-paged-job.mjs";
import { AUTHORIZATION_ID, RUN_ID, authorizationRecord, databaseApi, plain, runnerApi } from "./runner-page-store-loaded-with-fixture-authorization.mjs";

test("a step that reuses the saved section after earlier steps replaces what those steps gathered", async () => {
  // The saved section is recognized only on the second step, after ten rows were gathered while looking for it. The
  // saved section may hold more rows than were gathered, or fewer.
  for (const savedRecords of [150, 4]) {
    const { repository, job, startWorker, step, pages } = await pagedJob([10, { reuse: savedRecords }]);
    const runner = startWorker();
    await step(runner);
    const reused = await step(runner);
    assert.equal(reused.ok, true, JSON.stringify(reused.job?.failure ?? reused));
    assert.equal(reused.job.status, "complete");
    assert.equal((await repository.getJob(job.jobId)).recordsBySection.pledges, savedRecords);
    assert.equal(pages().length, 0);
    assert.equal((await repository.getJob(job.jobId)).updateSignals.pledges, "unchanged");
  }
});

test("an update reads the saved backup once for a section, however many steps the section takes", async () => {
  const saved = { sync: { sectionOutcomes: { pledges: { status: "complete", parserVersion: "1", records: 2 } } }, pledges: [{ recordKey: "saved-1" }, { recordKey: "saved-2" }], hangarLog: Array.from({ length: 500 }, (_, index) => ({ row: index })) };
  const { state, startWorker, step } = await pagedJob([10, 10, 10, 2], { mode: "update", seed: { snapshots: [{ accountId: "account-1", runId: "earlier", document: saved }] } });
  const runner = startWorker();
  for (let index = 0; index < 3; index += 1) await step(runner);
  assert.equal(state.snapshotReads, 1, "one read when the section starts");
  const steps = state.log.filter((entry) => entry.kind === "step");
  assert.deepEqual(steps.map((entry) => entry.previousSection), Array(3).fill({ current: true, values: { pledges: saved.pledges }, outcomes: { pledges: saved.sync.sectionOutcomes.pledges }, recordCount: 2 }));
  await step(runner);
  assert.equal(state.snapshotReads, 2, "and one more to assemble the finished document");

  // A worker that starts over reads it once more.
  const restarted = await pagedJob([10, 10, 2], { mode: "update", seed: { snapshots: [{ accountId: "account-1", runId: "earlier", document: saved }] } });
  await restarted.step(restarted.startWorker());
  await restarted.step(restarted.startWorker());
  assert.equal(restarted.state.snapshotReads, 2);
});

test("sections that each end in one step share a single read of the saved backup, through to the finished document", async () => {
  let clock = 80_000;
  let snapshotReads = 0;
  const sections = ["profile", "pledges", "buybacks"];
  const saved = {
    sync: { sectionOutcomes: Object.fromEntries(sections.map((section) => [section, { status: "complete", parserVersion: "1", records: 1 }])) },
    profile: { handle: "saved" }, pledges: [{ recordKey: "saved" }], buybacks: [{ recordKey: "saved" }]
  };
  const memory = databaseApi.createMemoryRepository({ snapshots: [{ accountId: "account-1", runId: "earlier", document: saved }] });
  const repository = { ...memory, getSnapshot: async (key) => { snapshotReads += 1; return memory.getSnapshot(key); } };
  const plan = { selectedSections: sections, maximumRecordsBySection: Object.fromEntries(sections.map((section) => [section, 5])), minimumInterRequestDelayMs: 900 };
  const job = runnerApi.createJob({ jobId: "job-shared", runId: RUN_ID, accountId: "account-1", authorizationId: AUTHORIZATION_ID, plan, mode: "update", now: new Date(clock).toISOString() });
  await repository.saveAuthorization({ ...authorizationRecord(clock), selectedSections: sections, maximumRecordsBySection: plan.maximumRecordsBySection });
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [] });
  const previous = [];
  const assembledFrom = [];
  const runner = runnerApi.createSerialRunner({
    repository,
    nowMs: () => clock,
    random: () => 0,
    registry: { adapters: sections.map((section) => ({ section, version: "1", parserVersion: "1", collectStep: async (input) => {
      previous.push(plain(input.previousSection.values));
      return { ok: true, accountId: "account-1", done: true, recordCount: 1, cumulativeRecordCount: 1, resultMode: "reuse", reusedPrevious: true, parserResults: [], changeState: "unchanged" };
    } })) },
    assembleDocument: async ({ previous: document }) => { assembledFrom.push(plain(document)); return { document: { kept: true } }; }
  });
  for (const section of sections) {
    assert.equal((await runner.tick(job.jobId)).ok, true, section);
    clock += 1000;
  }
  assert.equal((await repository.getJob(job.jobId)).status, "complete");
  assert.deepEqual(previous, [{ profile: saved.profile }, { pledges: saved.pledges }, { buybacks: saved.buybacks }]);
  assert.deepEqual(assembledFrom, [saved]);
  assert.equal(snapshotReads, 1);
});

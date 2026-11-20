import assert from "node:assert/strict";
import test from "node:test";
import { kept, runningBuild } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a section's pages are stored once while it is collected, and a finished run keeps only the saved backup", async () => {
  // 120 pledges are 12 pages: the first step reads one page and each later step two.
  const { harness, tab } = await runningBuild({ account: { counts: { pledges: 120 } } }, 9);
  await harness.advance(() => kept(harness).pages.filter((page) => page.section === "pledges").length >= 3);
  const during = kept(harness);
  const [job] = during.jobs;
  assert.equal(job.plan.selectedSections[job.sectionIndex], "pledges");
  assert.deepEqual(during.pages.map((page) => [page.section, page.step, page.checkpoint]), [["pledges", 1, false], ["pledges", 2, false], ["pledges", 3, false]]);
  assert.ok(during.pages.every((page) => page.collectionId === job.collectionId && page.pageKey.startsWith(`${job.runId}|pledges|`)));
  // Each page holds the rows of its own step only, and the hash it is checked against when read back.
  assert.deepEqual(during.pages.map((page) => JSON.parse(page.text).raw.length), [10, 20, 20]);
  const hash = async (text) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex");
  for (const page of during.pages) assert.equal(page.sha256, await hash(page.text));
  // The job record is a position: no collected rows, however far the section has got.
  assert.deepEqual(Object.keys(job.cursorBySection.pledges).sort(), ["interactiveState", "lastStep", "page"]);
  assert.equal(job.storedStepsBySection.pledges, 3);
  assert.equal(job.recordsBySection.pledges, 50);
  assert.ok(JSON.stringify(job).length < 20000, `the job record is ${JSON.stringify(job).length} characters`);
  // Finished sections are staged; the section in progress is not, until it ends.
  const stagedSections = during.stagedRuns[0].results.map((result) => result.section);
  assert.deepEqual(stagedSections.filter((section) => ["profile", "hangarLog", "pledges"].includes(section)), ["profile", "hangarLog"]);
  assert.ok(during.stagedRuns[0].results.every((result) => result.outcome.status === "complete"));

  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete");
  const after = kept(harness);
  assert.deepEqual(after.pages, [], "no page outlives its section");
  assert.equal(after.snapshots.length, 1);
  assert.equal(after.snapshots[0].document.pledges.length, 120);
  // The finished document is kept once, as the saved backup, not a second time beside the run.
  assert.deepEqual(after.stagedRuns.map((staged) => [staged.status, "results" in staged, "document" in staged]), [["promoted", false, false]]);
  assert.ok(JSON.stringify(after.stagedRuns).length < 5000);

  // Once the dashboard confirms it saved the file, nothing of the run's working copy is left.
  assert.equal((await tab.request("ACKNOWLEDGE_RESULT", { runId: finished.lastCompletedRunId })).ok, true);
  const acknowledged = kept(harness);
  assert.deepEqual([acknowledged.stagedRuns.length, acknowledged.pages.length, acknowledged.snapshots.length], [0, 0, 1]);
  tab.reload();
  assert.equal((await tab.build()).status.activeJob.mode, "update", "the saved backup is still the baseline for the next run");
});

test("a cancelled run keeps nothing it collected", async () => {
  const { harness, tab } = await runningBuild({ account: { counts: { pledges: 120 } } }, 9);
  await harness.advance(() => kept(harness).pages.length >= 2);
  assert.ok(kept(harness).stagedRuns[0].results.length >= 1);
  assert.equal((await tab.request("CANCEL")).ok, true);
  await harness.advanceBy(5000);
  const after = kept(harness);
  assert.deepEqual(after.pages, []);
  assert.deepEqual(after.stagedRuns.map((staged) => [staged.status, staged.results, staged.runReceipt.status]), [["cancelled", [], "cancelled"]]);
  assert.deepEqual(after.jobs.map((job) => [job.status, job.cursorBySection, job.storedStepsBySection]), [["cancelled", {}, {}]]);
  assert.equal(after.snapshots.length, 0);
});

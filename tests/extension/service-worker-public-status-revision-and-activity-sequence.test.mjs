// The public status's revision and activity numbers (PARSER_HARDENING.md §12.5): the revision grows strictly across
// a worker restart and stays the same for a status that did not change, and each activity keeps its sequence number.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";

test("the revision grows strictly across a worker restart, a status read changes nothing, and each activity keeps its number", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  await tab.build();
  const seen = [];
  const activities = new Map();
  const note = (status) => {
    seen.push(status.statusRevision);
    for (const activity of status.activeJob?.activityLog ?? []) {
      assert.ok(Number.isSafeInteger(activity.seq) && activity.seq > 0);
      if (activities.has(activity.seq)) assert.deepEqual(activity, activities.get(activity.seq), `activity ${activity.seq} changed`);
      activities.set(activity.seq, activity);
    }
  };
  for (let index = 0; index < 6; index += 1) {
    await harness.advanceBy(2_000);
    const first = await tab.status();
    const second = await tab.status();
    assert.equal(second.statusRevision, first.statusRevision, "a status read does not raise the revision");
    note(first);
  }
  for (const event of tab.events) if (event.status) note(event.status);
  // A restarted worker goes on from the stored revision and sequence.
  const beforeRestart = Math.max(...seen);
  const highestSeq = Math.max(...activities.keys());
  harness.stopWorker();
  await harness.advanceBy(31_000);
  const after = await tab.status();
  assert.ok(after.statusRevision >= beforeRestart);
  await harness.finishJob();
  const final = await tab.status();
  assert.ok(final.statusRevision > beforeRestart, "the revision grew after the restart");
  note(final);
  assert.ok(Math.max(...activities.keys()) > highestSeq, "the sequence went on after the restart");
  const polled = seen.slice(0, 6);
  for (let index = 1; index < polled.length; index += 1) assert.ok(polled[index] >= polled[index - 1], "polled revisions never fall");
  // The numbers of one job's log are strictly increasing in the order the lines were stored.
  const log = final.activeJob.activityLog;
  for (let index = 1; index < log.length; index += 1) assert.ok(log[index].seq > log[index - 1].seq);
});

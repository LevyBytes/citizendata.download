// Continue (PARSER_HARDENING.md §12.3, F7, F8): a continuation is checked at the failed job's own floor, so a roster
// run continues at 10 seconds; it starts at the first pace, as every run does; and it waits for nothing but a
// cool-down that has not ended.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";

const MEMBERS = "/api/orgs/getOrgMembers";

test("an account build continues at its own 900 ms floor, from the first pace, with no wait for a cool-down that ended", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  // A 401 signs the session out and stops the run.
  harness.rsi.failNext((request) => request.path === "/api/account/buybackPledges", { status: 401 });
  await tab.build();
  assert.equal((await harness.finishJob()).status, "failed");
  harness.local.set("citizendata.retryNotBefore", new Date(harness.clock.now - 1000).toISOString());
  const continuedAt = harness.clock.now;
  const before = harness.rsi.requests.length;
  const continued = await tab.request("CONTINUE_PARTIAL");
  assert.equal(continued.code, "RUN_STARTED", continued.message);
  const job = await harness.repository.getJob(harness.state().activeJobId);
  assert.deepEqual([job.mode, job.plan.minimumInterRequestDelayMs, job.pace.version, job.pace.factor], ["continuation", 900, 1, 2]);
  assert.equal(harness.rsi.requests[before].at, continuedAt, "the identify request was sent at once");
  assert.equal((await harness.finishJob()).status, "complete");
});

test("a roster run can be continued, at 10 seconds", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  await tab.build();
  await harness.finishJob();
  await tab.request("ACKNOWLEDGE_RESULT", { runId: harness.state().lastCompletedRunId });
  tab.reload();
  // RSI signs the session out at the roster's second page, so the run stops after its first.
  harness.rsi.failNext((request) => request.path === MEMBERS && request.page === 2, { status: 401 });
  assert.equal((await tab.request("PROPOSE_ORGANIZATION_ROSTER", { organizationSids: ["SYNTH"] })).code, "RUN_STARTED");
  assert.equal((await harness.finishJob()).status, "failed");

  const before = harness.rsi.requests.length;
  const continued = await tab.request("CONTINUE_PARTIAL");
  assert.equal(continued.code, "RUN_STARTED", continued.message);
  const job = await harness.repository.getJob(harness.state().activeJobId);
  assert.deepEqual([job.mode, job.plan.minimumInterRequestDelayMs, job.pace.factor], ["continuation", 10_000, 2]);
  assert.deepEqual([...job.plan.selectedSections], ["organizations.members.SYNTH"]);
  assert.equal((await harness.finishJob()).status, "complete");
  // The roster resumes at its second page, and its pages are at least the slow start's 20 seconds apart.
  const pages = harness.rsi.requests.slice(before).filter((request) => request.path === MEMBERS);
  assert.equal(pages[0].page, 2);
  for (let index = 1; index < pages.length; index += 1) assert.ok(pages[index].at - pages[index - 1].at >= 20_000, `gap ${pages[index].at - pages[index - 1].at} ms`);
});

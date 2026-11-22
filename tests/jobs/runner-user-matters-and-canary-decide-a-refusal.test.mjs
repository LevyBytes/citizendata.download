// The user's matters stop a refused run continuably, and the canary decides an unclear answer's class
// (PARSER_HARDENING.md §7.4, §7.7).
import assert from "node:assert/strict";
import test from "node:test";
import { UNCLEAR, plain, scripted, signal } from "./runner-fixture-scripted-pledges-job.mjs";

test("the user's matters stop the run for the time being, with their code and fixed message", async () => {
  for (const [reason, code, message] of [["signed-out", "RSI_SIGNED_OUT", "The RSI session is signed out."], ["account-changed", "RSI_ACCOUNT_CHANGED", "A different RSI account is signed in."], ["check-in-browser", "RSI_CHECK_IN_BROWSER",
    "RSI asks for a check in the browser."]]) {
    const { repository, runner, job } = await scripted([signal("user", "RSI_SESSION_NOT_AUTHENTICATED", { reason })]);
    await runner.tick(job.jobId);
    const stopped = await repository.getJob(job.jobId);
    assert.deepEqual([stopped.status, stopped.failure.code, stopped.failure.message, stopped.failure.detail.signal.reason], ["failed", code, message, reason]);
  }
});

test("the canary decides an unclear answer: an unclear canary is a limit, the same unclear answer after a good canary a change", async () => {
  // The canary itself answers unclearly: a limit.
  const { state, repository, runner, job } = await scripted([UNCLEAR, { ...UNCLEAR, fromCanary: true }]);
  await runner.tick(job.jobId);
  assert.equal((await repository.getJob(job.jobId)).pace.canaryDue, true);
  state.clock += 60_000;
  await runner.tick(job.jobId);
  assert.deepEqual([state.inputs[1].canary, state.inputs[1].canaryAfterSignal.code], [true, "RSI_HTML_HTTP_403"]);
  const limited = await repository.getJob(job.jobId);
  assert.equal(plain(limited.activityLog.at(-1)).signal.kind, "limit", "an unclear canary is handled as a limit");
  assert.equal(limited.pace.canaryDue, false);
  // The canary answers normally, and the step's own request gives the same unclear answer again: a changed contract.
  const again = await scripted([UNCLEAR, UNCLEAR]);
  await again.runner.tick(again.job.jobId);
  again.state.clock += 60_000;
  await again.runner.tick(again.job.jobId);
  assert.equal(again.state.inputs[1].canary, true);
  const changed = await again.repository.getJob(again.job.jobId);
  // A changed contract outside Account identity sets the section aside (§10.1); this plan has no other section.
  assert.deepEqual(plain([changed.status, changed.failure, changed.setAsideSections.map((entry) => [entry.section, entry.code]), changed.detectedChanges.map((entry) => entry.setAside)]), ["partial", null, [["pledges", "RSI_HTML_HTTP_403"]], [true]]);
});

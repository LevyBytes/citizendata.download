// A partial result (PARSER_HARDENING.md §12.6, §12.11) is given only to the dashboard origin and session that started
// the run, and a dashboard of the older protocol is refused before it could read one. The pending result is stored in
// the runtime record, the state's one durable source (§12.5).
import assert from "node:assert/strict";
import test from "node:test";
import { failedBuild } from "./failed-build-in-buybacks.mjs";

// The pending partial result of the failed build's job, for the session that started it.
async function pendingPartial(harness, job) {
  const authorization = await harness.repository.getAuthorization(job.authorizationId);
  await harness.repository.saveJob({ ...job, status: "partial" });
  const { dashboardOrigin, bridgeSessionId } = authorization;
  const pendingResult = { runId: job.runId, jobId: job.jobId, jobKind: "accountData", jobStatus: "partial", dashboardOrigin, bridgeSessionId, completedAt: job.completedAt };
  return { authorization, pendingResult };
}

test("a partial result is given only to the origin and session that started the run", async () => {
  const { harness, tab, job } = await failedBuild();
  // A run that ended with a section set aside (§10.3): WP7 produces it; here it is stored directly.
  const { authorization, pendingResult } = await pendingPartial(harness, job);
  await harness.repository.saveRuntime({ ...harness.state(), status: "partial", pendingResult });
  assert.equal(tab.bridgeSessionId, authorization.bridgeSessionId);
  // The session that started the run is told of it and given it, marked partial.
  assert.deepEqual((await tab.status()).completedResultPending, { runId: job.runId, jobKind: "accountData", status: "partial" });
  const own = await tab.request("GET_COMPLETED_RESULT");
  assert.deepEqual([own.ok, own.jobStatus, own.runId], [true, "partial", job.runId]);
  assert.ok(own.result && typeof own.result === "object");
  // Another tab of the same origin, with its own session, is not.
  const other = harness.openTab();
  assert.equal((await other.status()).completedResultPending, null);
  assert.equal((await other.request("GET_COMPLETED_RESULT")).code, "NO_COMPLETED_RESULT");
  assert.equal((await other.request("ACKNOWLEDGE_RESULT", { runId: job.runId })).code, "NO_COMPLETED_RESULT");
  // The saved complete snapshot is not replaced by the partial run.
  assert.notEqual((await harness.repository.getSnapshot(job.accountId))?.runId, job.runId);
  // The session that started it acknowledges it.
  assert.equal((await tab.request("ACKNOWLEDGE_RESULT", { runId: job.runId })).ok, true);
  assert.equal(harness.state().pendingResult, null);
});

test("a dashboard of the older protocol is refused before it could read a partial result", async () => {
  const { harness, tab, job } = await failedBuild();
  const { pendingResult } = await pendingPartial(harness, job);
  await harness.repository.saveRuntime({ ...harness.state(), pendingResult });
  for (const type of ["GET_STATUS", "GET_COMPLETED_RESULT"]) {
    const refused = await tab.request(type, null, { envelope: { protocolVersion: 1 } });
    assert.deepEqual([refused.ok, refused.code, refused.result, refused.status], [false, "PROTOCOL_MISMATCH", undefined, undefined]);
  }
  // The extension names its own version and plan floors to a dashboard that asks.
  const status = await tab.status();
  assert.deepEqual(status.capabilities.pacing, { accountPlanFloorMs: 900, rosterPlanFloorMs: 10_000 });
});

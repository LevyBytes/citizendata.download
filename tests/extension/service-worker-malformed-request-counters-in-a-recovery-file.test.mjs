// A recovery file whose running job holds malformed request counters or allowances (PARSER_HARDENING.md §7.13) is
// restored, and on Resume the run stops continuably before it sends RSI anything; Continue then starts a new run.
import assert from "node:assert/strict";
import test from "node:test";
import { runningBuild } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

const MALFORMED = Object.freeze({
  "negative count": (job) => ({ ...job, actualRequestCount: -2 }),
  "uncounted allowance": (job) => {
    const { probes: _probes, ...rest } = job.actualRequestsByAllowance;
    return { ...job, actualRequestsByAllowance: rest };
  },
  "allowance without a bound": (job) => {
    const { baseline: _baseline, ...rest } = job.maximumActualRequests;
    return { ...job, maximumActualRequests: rest };
  },
  "allowance as text": (job) => ({ ...job, maximumActualRequests: { ...job.maximumActualRequests, retries: "10" } })
});

for (const [name, change] of Object.entries(MALFORMED)) {
  test(`a restored job with ${name} stops on Resume before any request, and can be continued`, async () => {
    const { harness, tab } = await runningBuild({ account: { latencyMs: 300 } }, 7);
    assert.equal((await tab.request("PAUSE")).ok, true);
    await harness.advanceBy(5_000);
    const backup = (await harness.popup.request("EXPORT_BACKUP")).backup;
    const jobId = harness.state().activeJobId;
    backup.stores.jobs = backup.stores.jobs.map((job) => job.jobId === jobId ? change(job) : job);
    assert.equal((await harness.popup.request("IMPORT_BACKUP", { backup })).ok, true);
    const before = harness.rsi.requests.length;
    await tab.request("RESUME");
    await harness.advanceBy(30_000);
    const stopped = await harness.repository.getJob(jobId);
    assert.deepEqual([stopped.status, stopped.failure.code], ["failed", "REQUEST_COUNTERS_INVALID"]);
    assert.equal(harness.rsi.requests.length, before, "nothing was sent to RSI");
    const status = await tab.status();
    assert.equal(status.activeJob.failure.message, "The run's stored request counts could not be read.");
    assert.equal(status.continuable, true);
    const continued = await tab.request("CONTINUE_PARTIAL");
    assert.equal(continued.code, "RUN_STARTED", continued.message);
    assert.equal((await harness.finishJob()).status, "complete");
  });
}

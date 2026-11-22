import assert from "node:assert/strict";
import { createSyntheticRsi, dashboard, extensionPage, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { assertCompleteDocument } from "./complete-document-expectations.mjs";
import { freshDashboard, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { afterRequests, holdRsiWhen, reach, settled } from "./held-rsi-requests.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { sectionOrderOf } from "./section-order-of-requests.mjs";
import { stopServiceWorker } from "./service-worker-stop-storage-heap-and-errors.mjs";
import { changeStoredJob, storedState, waitForExportedFile, waitForState } from "./stored-state-alarms-and-saved-files.mjs";

const COUNTS = { pledges: 8, buybacks: 6, orders: 3, storeCredit: 4, uec: 2, rec: 2, prospects: 3 };

function storedJob(jobId) {
  return extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'EXPORT_BACKUP' }).then(({ backup }) => backup.stores.jobs.find((job) => job.jobId === ${JSON.stringify(jobId)}) ?? null)`);
}

// A build paused after its first sections, its worker stopped, and its stored job changed as an extension update
// would find it. `change` is the source of a function from the stored job to the job to store.
async function pausedAndChanged(account, change) {
  const held = holdRsiWhen(afterRequests(account, 10));
  await startBuild(dashboard);
  await reach(held, "the build to be past its first sections");
  await click(dashboard, "pauseCollection");
  const paused = await waitForState((state) => state.status === "paused", 8000, "the job to pause");
  held.release();
  await settled(account, "A paused job kept sending requests.");
  await stopServiceWorker();
  await changeStoredJob(paused.activeJobId, change);
  return paused.activeJobId;
}

// A stored pace this controller cannot read stops the run, continuably (PARSER_HARDENING.md §6.2, §7.14): the job
// fails with PACE_STATE_INVALID and the panel offers Continue. Continue then finishes the build, and its requests keep
// the canonical section order (§4.8).
async function stopsContinuablyAndContinues(handle, change) {
  await freshDashboard();
  const account = createSyntheticRsi({ handle, counts: COUNTS });
  setRsi(account);
  const jobId = await pausedAndChanged(account, change);
  const before = account.requests.length;
  await click(dashboard, "resumeCollection");
  await dashboard.waitFor("document.getElementById('overlaySummary').textContent === 'READY TO CONTINUE' && document.getElementById('resumeCollection').getClientRects().length > 0", 15000, "the panel to offer Continue");
  const stopped = await storedJob(jobId);
  assertStep(stopped?.status === "failed" && stopped.failure?.code === "PACE_STATE_INVALID", `The unreadable pace did not stop the run continuably: ${JSON.stringify({ status: stopped?.status, failure: stopped?.failure })}`);
  assert.equal(account.requests.length, before, "A run whose pace could not be read sent a request.");
  await click(dashboard, "resumeCollection");
  await waitForSavedDialog(dashboard, 120000);
  assertCompleteDocument(JSON.parse((await waitForExportedFile(handle)).text), account);
  const continuation = sectionOrderOf(account.requests.slice(before), handle);
  assertStep(continuation.outOfOrder.length === 0, `The continuation left the canonical section order: ${continuation.outOfOrder.join("; ")}`);
  return continuation.order;
}

// The extension update of PARSER_HARDENING.md §15.5. A job stored before the pace controller gets the first pace once,
// records PACE_STATE_MIGRATED and completes. A malformed and a future-version pace each stop the run continuably,
// and Continue finishes it in the canonical order.
export async function paceStateAfterUpdate() {
  await freshDashboard();
  const account = createSyntheticRsi({ handle: "MigrateCitizen", counts: COUNTS });
  setRsi(account);
  const jobId = await pausedAndChanged(account, `(job) => { const { pace, pendingStep, actualRequestCount, actualRequestsBySection, actualRequestsByAllowance, retriedHttpRequestCount, maximumActualRequests, paceHistory, ...older } = job; return older; }`);
  await click(dashboard, "resumeCollection");
  await waitForSavedDialog(dashboard, 120000);
  assertCompleteDocument(JSON.parse((await waitForExportedFile("MigrateCitizen")).text), account);
  const migrated = await storedJob(jobId);
  assertStep(migrated?.status === "complete" && (migrated.warnings ?? []).filter((warning) => warning === "PACE_STATE_MIGRATED").length === 1 && migrated.pace?.factor >= 1,
    `The job stored before the pace controller was not migrated once: ${JSON.stringify({ status: migrated?.status, warnings: migrated?.warnings, factor: migrated?.pace?.factor })}`);
  assert.equal((await storedState()).status, "complete");

  const malformed = await stopsContinuablyAndContinues("MalformedPaceCitizen", "(job) => ({ ...job, pace: { ...job.pace, factor: 'fast' } })");
  const future = await stopsContinuablyAndContinues("FuturePaceCitizen", "(job) => ({ ...job, pace: { ...job.pace, version: job.pace.version + 1 } })");
  return { migrated: true, malformedContinuation: malformed, futureContinuation: future };
}

import assert from "node:assert/strict";
import { createSyntheticRsi, dashboard, extensionPage, setDashboard, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { asksForApproval, offersAccount, waitForChooser } from "./build-chooser.mjs";
import { assertCompleteDocument } from "./complete-document-expectations.mjs";
import { freshDashboard, openDashboard, selectCurrentRsiAccount, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { longestGap } from "./harness-parity-and-request-measures.mjs";
import { pause } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { storedCollection, workerHeap } from "./service-worker-stop-storage-heap-and-errors.mjs";
import { downloadedDocuments, waitForDownloads, waitForState } from "./stored-state-alarms-and-saved-files.mjs";

export async function largeAccount() {
  // When the earlier scenarios ran, they revoked the local copy and cleared its request; a reload asks again and
  // the popup's request allows it. Run on its own, the copy is still allowed from the approval scenario.
  await dashboard.close();
  setDashboard(await openDashboard());
  const connection = await waitForChooser(dashboard, (state) => asksForApproval(state) || offersAccount(state), "the local copy to connect or to ask for approval");
  if (asksForApproval(connection)) {
    const tabs = await extensionPage.evaluate("chrome.storage.session.get('citizendata.localPending.v1').then((stored) => Object.keys(stored['citizendata.localPending.v1'] ?? {}).map(Number))");
    assert.equal(await extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'APPROVE_LOCAL_DASHBOARD', tabId: ${tabs.at(-1)} }).then((response) => response.ok)`), true);
  }
  await freshDashboard();
  const account = createSyntheticRsi({ handle: "LargeCitizen", counts: { pledges: 3000, buybacks: 6000, orders: 2500, storeCredit: 400, uec: 200, rec: 100, prospects: 9000, recruits: 300, legacyRecruits: 40 }, upgradeBuybacksFrom: 1600 });
  setRsi(account);
  await selectCurrentRsiAccount(dashboard, "LargeCitizen");
  const savedBefore = (await downloadedDocuments()).length;
  const started = Date.now();
  await startBuild(dashboard);
  // While it runs: the worker's memory, the size of what is stored, and the pages of the section in progress.
  const readings = { heapInUse: [], heapHeld: [], storedMegabytes: [], pages: [], jobCharacters: [] };
  let sampling = true;
  let endSampling;
  const buildEnded = new Promise((resolve) => { endSampling = resolve; });
  const sampler = (async () => {
    while (sampling) {
      await Promise.race([pause(2000), buildEnded]);
      if (!sampling) break;
      const [heap, usage, stored] = await Promise.all([
        workerHeap().catch(() => null),
        extensionPage.evaluate("navigator.storage.estimate().then((estimate) => estimate.usage)").catch(() => null),
        storedCollection().catch(() => null)
      ]);
      if (heap) { readings.heapInUse.push(heap.inUse); readings.heapHeld.push(heap.held); }
      if (usage !== null) readings.storedMegabytes.push(Number((usage / 1048576).toFixed(1)));
      if (stored) { readings.pages.push(stored.pages.length); readings.jobCharacters.push(stored.largestJobCharacters); }
    }
  })();
  try {
    await waitForSavedDialog(dashboard, 30 * 60 * 1000);
  } finally {
    sampling = false;
    endSampling();
  }
  await sampler;
  const seconds = (Date.now() - started) / 1000;
  const documents = await waitForDownloads(savedBefore + 1, 60000);
  const backup = documents.find((entry) => entry.name.includes("LargeCitizen"));
  assertCompleteDocument(JSON.parse(backup.text), account);
  const requests = account.requests;
  // Pacing must not degrade as the collected data grows.
  const tenth = Math.max(5, Math.floor(requests.length / 10));
  const meanGap = (slice) => (slice.at(-1).at - slice[0].at) / (slice.length - 1);
  await waitForState((state) => state.status === "complete" && state.pendingResult === null, 15000, "the saved result to be acknowledged");
  const storedAfter = await storedCollection();
  const usageAfter = await extensionPage.evaluate("navigator.storage.estimate().then((estimate) => estimate.usage)");
  const heapAfter = await workerHeap().catch(() => null);
  const peak = (values) => values.length ? Math.max(...values) : null;
  const detail = {
    seconds: Number(seconds.toFixed(1)), requests: requests.length, requestsPerSecond: Number((requests.length / seconds).toFixed(2)), longestPauseMs: longestGap(requests),
    earlyMeanGapMs: Math.round(meanGap(requests.slice(5, 5 + tenth))), lateMeanGapMs: Math.round(meanGap(requests.slice(-tenth))), megabytes: Number((backup.text.length / 1048576).toFixed(2)),
    samples: readings.heapInUse.length, workerHeapPeakInUseMegabytes: peak(readings.heapInUse), workerHeapPeakHeldMegabytes: peak(readings.heapHeld), workerHeapHeldAfterMegabytes: heapAfter?.held ?? null,
    storedPeakMegabytes: peak(readings.storedMegabytes), storedAfterMegabytes: Number((usageAfter / 1048576).toFixed(1)), mostStoredPages: peak(readings.pages), largestJobRecordCharacters: peak(readings.jobCharacters)
  };
  assertStep(detail.longestPauseMs < 8000, `Collection stalled on a large account: ${JSON.stringify(detail)}`);
  // Pacing must hold from the first tenth of the run to the last, and the job record must stay a position.
  assertStep(detail.lateMeanGapMs < detail.earlyMeanGapMs * 1.5 + 250, `Collection slowed as the account grew: ${JSON.stringify(detail)}`);
  assertStep(detail.largestJobRecordCharacters !== null && detail.largestJobRecordCharacters < 20000, `The job record grew with the account: ${JSON.stringify(detail)}`);
  assert.deepEqual({ pages: storedAfter.pages, stagedRuns: storedAfter.stagedRuns }, { pages: [], stagedRuns: [] }, "A saved run must leave no working copy behind.");
  return detail;
}

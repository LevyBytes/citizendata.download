import assert from "node:assert/strict";
import { createSyntheticRsi, dashboard, extensionPage, setDashboard, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { assertCompleteDocument } from "./complete-document-expectations.mjs";
import { freshDashboard, openDashboard, selectCurrentRsiAccount, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { PACE_KEY } from "./extension-copy-without-pacing.mjs";
import { longestGap, waitForRequests } from "./harness-parity-and-request-measures.mjs";
import { WATCHDOG } from "./origins-keys-and-stand-in-image.mjs";
import { QUIET_MS, pause } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { stopServiceWorker } from "./service-worker-stop-storage-heap-and-errors.mjs";
import { alarms, downloadedDocuments, storedState, waitForDownloads, waitForState } from "./stored-state-alarms-and-saved-files.mjs";

export async function watchdogRestartAndResultRecovery() {
  // The one scenario that needs real time, and so the extension's own pace. Chrome fires a packed extension's alarm
  // no sooner than 30 seconds, and ends a service worker it takes for idle after 30 seconds. That the watchdog
  // restarts a stopped build, and that a build at the shipped pace outlives the idle limit, can only be seen by
  // letting those seconds pass.
  await extensionPage.evaluate(`chrome.storage.local.set({ ${JSON.stringify(PACE_KEY)}: true })`);
  await freshDashboard();
  const account = createSyntheticRsi({ handle: "WatchdogCitizen", counts: { pledges: 80, buybacks: 400, orders: 100, prospects: 150 }, upgradeBuybacksFrom: 40 });
  setRsi(account);
  await selectCurrentRsiAccount(dashboard, "WatchdogCitizen");
  const savedBefore = (await downloadedDocuments()).length;
  await startBuild(dashboard);
  await waitForRequests(account, 8, 30000, "the run to be under way");
  // With the dashboard closed nothing polls the extension, so only the alarm can restart a stopped loop.
  await dashboard.close();
  setDashboard(null);
  const [alarm] = await alarms();
  assertStep(alarm?.name === WATCHDOG, "The watchdog alarm was missing during the run.");
  await stopServiceWorker();
  const stoppedAt = Date.now();
  const requestsAtStop = account.requests.length;
  // Longer than one step at the shipped pace. It passes inside the wait for the alarm and adds nothing to it.
  await pause(3000);
  assertStep(account.requests.length <= requestsAtStop + 1, "Requests continued although the service worker was stopped.");
  assert.equal((await storedState()).status, "running", "The stored job must still be marked running after the worker stops.");

  await waitForRequests(account, requestsAtStop + 3, 45000, "the watchdog alarm to restart the loop");
  const resumedAt = account.requests[requestsAtStop + 1].at;
  const silenceSeconds = (resumedAt - stoppedAt) / 1000;
  assertStep(resumedAt >= alarm.scheduledTime - 1500 && resumedAt <= alarm.scheduledTime + 10000, `The loop restarted ${((resumedAt - alarm.scheduledTime) / 1000).toFixed(1)} s from the watchdog alarm; it must restart when the alarm fires.`);
  assertStep(silenceSeconds <= 40, `The loop stayed stopped for ${silenceSeconds.toFixed(1)} s.`);

  const finished = await waitForState((state) => state.status === "complete", 240000, "the restarted run to finish");
  const afterRestart = account.requests.filter((request) => request.at >= resumedAt);
  const runSeconds = (afterRestart.at(-1).at - resumedAt) / 1000;
  // Longer than Chrome's 30 second idle limit, with no debugger attached and no dashboard polling.
  assertStep(runSeconds > 35, `The run after the restart lasted only ${runSeconds.toFixed(1)} s, too short to show the worker outliving the idle limit.`);
  assertStep(longestGap(afterRestart) < 5000, `Collection stalled for ${longestGap(afterRestart)} ms after the restart.`);
  assertStep(finished.pendingResult?.runId === finished.lastCompletedRunId && finished.pendingResult.dashboardOrigin === "file://", `A result finished with no dashboard must be kept for it: ${JSON.stringify(finished.pendingResult)}`);
  assert.equal((await downloadedDocuments()).length, savedBefore, "Nothing can have been saved while no dashboard was open.");
  assert.deepEqual(await alarms(), [], "No alarm may remain after the run.");

  // A dashboard opened afterwards is handed the finished result, saves it, and confirms.
  setDashboard(await openDashboard());
  const outcome = await waitForSavedDialog(dashboard, 30000);
  assertStep(outcome.message.includes("finished while the dashboard was not connected"), `The recovered result was not described as recovered: ${outcome.message}`);
  const documents = await waitForDownloads(savedBefore + 1);
  assertCompleteDocument(JSON.parse(documents.find((entry) => entry.name.includes("WatchdogCitizen")).text), account);
  await waitForState((state) => state.pendingResult === null, 8000, "the recovered result to be acknowledged");
  // Once confirmed it is not offered again.
  await freshDashboard();
  await pause(QUIET_MS);
  assert.equal((await downloadedDocuments()).length, savedBefore + 1, "An acknowledged result was delivered a second time.");
  await extensionPage.evaluate(`chrome.storage.local.remove(${JSON.stringify(PACE_KEY)})`);
  return {
    silenceSeconds: Number(silenceSeconds.toFixed(1)), secondsFromAlarm: Number(((resumedAt - alarm.scheduledTime) / 1000).toFixed(1)),
    runSecondsAfterRestart: Number(runSeconds.toFixed(1)), longestPauseMs: longestGap(afterRestart), requests: account.requests.length
  };
}

import assert from "node:assert/strict";
import { createSyntheticRsi, dashboard, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { freshDashboard, selectCurrentRsiAccount, startBuild } from "./dashboard-pages-and-builds.mjs";
import { afterRequests, holdRsiWhen, reach, settled } from "./held-rsi-requests.mjs";
import { WATCHDOG } from "./origins-keys-and-stand-in-image.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { alarms, downloadedDocuments, storedState, waitForState } from "./stored-state-alarms-and-saved-files.mjs";

export async function pauseResumeCancel() {
  await freshDashboard();
  const account = createSyntheticRsi({ handle: "ControlCitizen", counts: { pledges: 120, buybacks: 600 }, upgradeBuybacksFrom: 40 });
  setRsi(account);
  await selectCurrentRsiAccount(dashboard, "ControlCitizen");
  const savedBefore = (await downloadedDocuments()).length;
  // The build is held at its seventh request and paused there.
  let held = holdRsiWhen(afterRequests(account, 6));
  await startBuild(dashboard);
  await reach(held, "the build to reach its seventh request");
  await click(dashboard, "pauseCollection");
  await waitForState((state) => state.status === "paused", 8000, "the job to pause");
  // The step in flight may finish; after that nothing more is sent.
  held.release();
  const atPause = await settled(account, "A paused job kept sending requests.");
  assert.equal((await storedState()).status, "paused", "An in-flight step overwrote the pause.");
  assert.deepEqual(await alarms(), [], "A paused job must not hold the watchdog alarm.");
  await dashboard.waitFor("document.getElementById('resumeCollection').getClientRects().length > 0 && document.getElementById('pauseCollection').getClientRects().length === 0", 8000, "the dashboard to offer Resume");

  // Resumed, it is held again four requests on, and cancelled there.
  held = holdRsiWhen(afterRequests(account, atPause + 4));
  await click(dashboard, "resumeCollection");
  await waitForState((state) => state.status === "running", 8000, "the job to resume");
  await reach(held, "collection to continue after resume");
  assert.deepEqual((await alarms()).map((alarm) => alarm.name), [WATCHDOG], "A resumed job must hold the watchdog alarm again.");

  await click(dashboard, "cancelCollection");
  await waitForState((state) => state.status === "cancelled" && state.activeJobId === null, 8000, "the job to cancel");
  held.release();
  const atCancel = await settled(account, "A cancelled job kept sending requests.");
  assert.equal((await storedState()).status, "cancelled", "An in-flight step overwrote the cancellation.");
  assert.deepEqual(await alarms(), [], "A cancelled job must not hold the watchdog alarm.");
  assert.equal((await downloadedDocuments()).length, savedBefore, "A cancelled run must not save a backup.");
  return { requestsAtPause: atPause, requestsAtCancel: atCancel };
}

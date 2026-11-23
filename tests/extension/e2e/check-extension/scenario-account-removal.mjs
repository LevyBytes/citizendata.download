import assert from "node:assert/strict";
import { clearAllAndAllowTheLocalCopy, storeRecordsNoBuildMakes, storedAfterRemoval } from "./accountremovalstoredrecords.mjs";
import { chrome, createSyntheticRsi, dashboard, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { freshDashboard, selectCurrentRsiAccount, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { afterRequests, holdRsiWhen, reach, settled } from "./held-rsi-requests.mjs";
import { TOKEN } from "./origins-keys-and-stand-in-image.mjs";
import { click, clickExpression } from "./page-clicks-and-extension-pages.mjs";
import { COUNTS } from "./pausecancelracebuilds.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { stopServiceWorker } from "./service-worker-stop-storage-heap-and-errors.mjs";
import { waitForState } from "./stored-state-alarms-and-saved-files.mjs";

// Remove this account, end to end, on the extension's real IndexedDB. RemovedCitizen has two finished builds, so one
// earlier build is kept, and then a cancelled build; StayingCitizen has one build. Each has an Orgs JSON, and both
// share one kept image. RemovedCitizen, the account selected, is removed under Switch Account, confirmed in the dialog,
// through the dashboard's own REMOVE_ACCOUNT request. With the worker stopped and the dashboard loaded again, the
// database read afresh holds nothing of RemovedCitizen: no latest build, earlier build, Orgs JSON or cancelled run.
// StayingCitizen's records, the shared image and the image pace history are there, and StayingCitizen is selected.
const REMOVED = "RemovedCitizen";
const STAYING = "StayingCitizen";
const menuItem = (handle) => `[...document.querySelectorAll('#accountMenuAccounts [role="menuitemradio"]')].find((item) => item.textContent.includes(${JSON.stringify(handle)}))`;
const shown = (handle, description) => dashboard.waitFor(`document.getElementById('accountHandle').textContent === ${JSON.stringify(handle)}`, 8000, description);

async function finishedBuild(account, handle, { add = true } = {}) {
  await freshDashboard();
  setRsi(account);
  if (add) await selectCurrentRsiAccount(dashboard, handle);
  await startBuild(dashboard);
  await waitForSavedDialog(dashboard, 120000);
}

// The last run to end, since a run that ends later removes it (removeSupersededRuns). RSI is signed in to
// RemovedCitizen again and it is chosen under Switch Account, which selects it.
async function cancelledBuild(account) {
  await freshDashboard();
  setRsi(account);
  const value = `${TOKEN}-${REMOVED.toLowerCase()}`;
  await chrome.send("Storage.setCookies", { cookies: [{ name: "Rsi-Token", value, domain: "robertsspaceindustries.com", path: "/", secure: true, httpOnly: true }] });
  await click(dashboard, "switchAccountButton");
  await clickExpression(dashboard, menuItem(REMOVED));
  await shown(REMOVED, `${REMOVED} to be chosen`);
  const held = holdRsiWhen(afterRequests(account, account.requests.length + 4));
  await startBuild(dashboard);
  await reach(held, "the third build to reach its fourth request");
  await click(dashboard, "cancelCollection");
  await waitForState((state) => state.status === "cancelled" && state.activeJobId === null, 8000, "the build to cancel");
  held.release();
  await settled(account, "A cancelled build kept sending requests.");
}

export async function accountRemoval() {
  await clearAllAndAllowTheLocalCopy();
  const removed = createSyntheticRsi({ handle: REMOVED, counts: COUNTS });
  await finishedBuild(removed, REMOVED);
  removed.addPledges(1);
  await finishedBuild(removed, REMOVED, { add: false });
  await finishedBuild(createSyntheticRsi({ handle: STAYING, counts: COUNTS }), STAYING);
  await cancelledBuild(removed);
  await storeRecordsNoBuildMakes([REMOVED, STAYING]);
  const before = await storedAfterRemoval();
  const cancelledRunId = before.incomplete.find(([handle, status]) => handle === REMOVED && status === "cancelled")?.[2];
  assertStep(before.snapshots.join() === `${REMOVED},${STAYING}` && before.history.filter(([handle]) => handle === REMOVED).length === 2 && cancelledRunId && before.registry.selectedKey === "rsi:removedcitizen",
    `The records to remove were not all stored: ${JSON.stringify(before)}`);

  // The account selected is shown, and removed under Switch Account, with the dialog confirmed.
  await freshDashboard();
  await shown(REMOVED, `${REMOVED} to be shown`);
  const label = await dashboard.evaluate(`(() => { document.getElementById('switchAccountButton').click(); return ${menuItem(REMOVED)}.querySelector('.account-menu-label').textContent; })()`);
  await click(dashboard, "removeAccountCommand");
  await dashboard.waitFor("document.getElementById('removeAccountDialog').open", 8000, "the removal to be asked");
  assert.equal(await dashboard.evaluate("document.getElementById('removeAccountDialogTitle').textContent"), `Remove ${label}?`);
  await click(dashboard, "removeAccountConfirm");
  await dashboard.waitFor(`document.getElementById('statusToast').textContent === ${JSON.stringify(`${label} is removed.`)} && document.getElementById('accountHandle').textContent === ${JSON.stringify(STAYING)}`,
    8000, "the account to be removed and the other one shown");

  // A stopped worker and a dashboard loaded again find the same.
  await stopServiceWorker();
  await freshDashboard();
  await shown(STAYING, `${STAYING} to be shown after the reload`);
  const listed = await dashboard.evaluate(`(() => { document.getElementById('switchAccountButton').click(); const items = [...document.querySelectorAll('#accountMenuAccounts [role="menuitemradio"]')].map((item) => item.textContent);
    document.getElementById('switchAccountButton').click(); return items; })()`);
  const after = await storedAfterRemoval();
  assert.deepEqual(after.snapshots, [STAYING], "RemovedCitizen's latest build is still stored.");
  assert.deepEqual([after.history, after.historyData], [[[STAYING, "organizations"]], 1], "RemovedCitizen's earlier build or Orgs JSON is still kept.");
  assert.deepEqual(after.incomplete.filter(([handle]) => handle === REMOVED), [], "RemovedCitizen's cancelled build is still stored.");
  assert.equal(after.stagedRunIds.includes(cancelledRunId), false, "The cancelled build's staged run is still stored.");
  assert.deepEqual([after.media, after.imagePaceHistory, after.registry], [[1, 1], true, { accounts: ["rsi:stayingcitizen"], selectedKey: "rsi:stayingcitizen" }]);
  assertStep(listed.length === 1 && listed[0].includes(STAYING), `Switch Account lists more than the account left: ${JSON.stringify(listed)}`);
  return { before: { snapshots: before.snapshots.length, history: before.history.length, incomplete: before.incomplete.length }, after: { snapshots: after.snapshots.length, history: after.history.length } };
}

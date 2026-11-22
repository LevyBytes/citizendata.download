import assert from "node:assert/strict";
import { createSyntheticRsi, dashboard, extensionPage, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { freshDashboard, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { afterRequests, holdRsiWhen, reach, settled } from "./held-rsi-requests.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { POLL_MS, pause } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { storedState, waitForExportedFile } from "./stored-state-alarms-and-saved-files.mjs";

export async function skipCcuPrices() {
  // The dashboard offers Skip while CCU buy-back prices are read, and nowhere else. A build skipped there finishes
  // as a complete build and is saved like any other.
  await freshDashboard();
  const account = createSyntheticRsi({ handle: "SkipCitizen", counts: { pledges: 12, buybacks: 24, orders: 5, storeCredit: 5, uec: 3, rec: 2, olderHangarLogRows: 5, prospects: 5, recruits: 2, legacyRecruits: 1, organizationMembers: 5 } });
  setRsi(account);
  const priceCalls = () => account.requests.filter((request) => request.operations?.includes("getPrice")).length;
  const skipShown = "document.getElementById('skipCollection').getClientRects().length > 0";
  // The build is held early on, where Skip must not be offered, and again at the first request of the CCU price
  // stage, where it must.
  let held = holdRsiWhen(afterRequests(account, 3));
  await startBuild(dashboard);
  await reach(held, "the build to be under way");
  await dashboard.waitFor("document.getElementById('pauseCollection').getClientRects().length > 0", 8000, "the running build to offer Pause");
  assert.equal(await dashboard.evaluate(skipShown), false, "Skip was offered before the CCU price stage.");
  held.release();
  held = holdRsiWhen((request) => new URL(request.url).pathname === "/api/account/v2/setAuthToken");
  await reach(held, "the CCU price stage to begin", 120000);
  await dashboard.waitFor(
    `${skipShown} && document.getElementById('pauseCollection').getClientRects().length > 0 && document.getElementById('cancelCollection').getClientRects().length > 0`,
    8000, "Skip to be offered beside Pause and Cancel while CCU buy-back prices are read"
  );
  assert.equal(await dashboard.evaluate("document.getElementById('collectionActivityLabel').textContent"), "CCU buyback prices");
  await click(dashboard, "skipCollection");
  // The extension has taken the Skip once its job record says so; then the held request is let go.
  const skipTaken = () => extensionPage.evaluate("chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'EXPORT_BACKUP' }).then(({ backup }) => backup.stores.jobs.some((job) => (job.skipSections ?? []).includes('buybackUpgradePrices')))");
  for (const deadline = Date.now() + 8000; !(await skipTaken());) {
    assertStep(Date.now() < deadline, "The extension did not take the Skip.");
    await pause(POLL_MS);
  }
  held.release();
  const saved = await waitForSavedDialog(dashboard, 120000);
  const document = JSON.parse((await waitForExportedFile("SkipCitizen")).text);
  const different = new Set(account.state.buybacks.filter((buyback) => buyback.upgrade).map((buyback) => `${buyback.upgrade.fromShipId}:${buyback.upgrade.toShipId}:${buyback.upgrade.toSkuId}`)).size;
  const outcome = document.sync.sectionOutcomes.buybackUpgradePrices;
  const read = document.buybackUpgradePrices.length;
  assert.deepEqual([...new Set(Object.values(document.sync.sectionOutcomes).map((entry) => entry.status))], ["complete"], "A build whose CCU prices were skipped must be a complete build.");
  assertStep(read < different && priceCalls() === read, `Skip did not end the reading where it stood: ${read} of ${different} read with ${priceCalls()} price requests.`);
  assert.deepEqual(outcome.warnings, [`The CCU buy-back prices were skipped after ${read} of ${different} were read.`]);
  // Nothing more is asked of RSI once the build has ended.
  await settled(account, "A skipped build kept asking RSI.");
  assert.equal(priceCalls(), read, "A skipped stage kept asking prices.");
  assert.equal((await storedState()).status, "complete");
  return { read, different, title: saved.title };
}

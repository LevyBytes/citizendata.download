import { createSyntheticRsi, dashboard, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { assertCompleteDocument } from "./complete-document-expectations.mjs";
import { freshDashboard, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { afterRequests, holdRsiWhen, reach, settled } from "./held-rsi-requests.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { downloadedDocuments, waitForDownloads, waitForState } from "./stored-state-alarms-and-saved-files.mjs";

export async function reloadAndReconnect() {
  await freshDashboard();
  const account = createSyntheticRsi({ handle: "ReconnectCitizen", counts: { pledges: 150, buybacks: 500 }, upgradeBuybacksFrom: 40 });
  setRsi(account);
  const savedBefore = (await downloadedDocuments()).length;
  const held = holdRsiWhen(afterRequests(account, 6));
  await startBuild(dashboard);
  await reach(held, "the build to reach its seventh request");
  // A reloaded page is a new bridge session. It does not own the run, so its first status request pauses it.
  await dashboard.send("Page.reload");
  await waitForState((state) => state.status === "paused", 15000, "the reloaded dashboard to pause the run it does not own");
  // The Build Status panel comes back collapsed after a reload; the offer is inside it.
  await dashboard.waitFor("document.readyState === 'complete' && !document.getElementById('parserOverlay').hidden", 15000, "the Build Status panel to return after the reload");
  if (await dashboard.evaluate("document.getElementById('minimizeOverlay').getAttribute('aria-expanded') === 'false'")) await click(dashboard, "minimizeOverlay");
  await dashboard.waitFor("document.getElementById('rebindCollection').getClientRects().length > 0", 15000, "the dashboard to offer Reconnect paused run");
  assertStep(await dashboard.evaluate("['pauseCollection', 'resumeCollection', 'cancelCollection'].every((id) => document.getElementById(id).getClientRects().length === 0)"), "A dashboard that does not own the run must not offer its controls.");
  held.release();
  const atPause = await settled(account, "The run kept requesting while it waited to be reconnected.");
  await click(dashboard, "rebindCollection");
  await waitForState((state) => state.status === "running", 8000, "the reconnected run to resume");
  await waitForSavedDialog(dashboard, 180000);
  const documents = await waitForDownloads(savedBefore + 1);
  assertCompleteDocument(JSON.parse(documents.find((entry) => entry.name.includes("ReconnectCitizen")).text), account);
  return { requestsAtReload: atPause, requests: account.requests.length };
}

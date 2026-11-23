import { createSyntheticRsi, dashboard, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { assertCompleteDocument } from "./complete-document-expectations.mjs";
import { freshDashboard, selectCurrentRsiAccount, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { afterRequests, holdRsiWhen, reach } from "./held-rsi-requests.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { downloadedDocuments, waitForDownloads, waitForState } from "./stored-state-alarms-and-saved-files.mjs";

export async function reloadAndReconnect() {
  await freshDashboard();
  const account = createSyntheticRsi({ handle: "ReconnectCitizen", counts: { pledges: 150, buybacks: 500 }, upgradeBuybacksFrom: 40 });
  setRsi(account);
  await selectCurrentRsiAccount(dashboard, "ReconnectCitizen");
  const savedBefore = (await downloadedDocuments()).length;
  const held = holdRsiWhen(afterRequests(account, 6));
  await startBuild(dashboard);
  await reach(held, "the build to reach its seventh request");
  // A reloaded page is a new bridge session. It does not own the run; its status requests leave the run running.
  await dashboard.send("Page.reload");
  // A status never shows the panel (PARSER_HARDENING.md §11.2): after the reload Build opens it, as the user's action;
  // the offer is inside it.
  await dashboard.waitFor("document.readyState === 'complete' && document.getElementById('overlaySummary').textContent === 'RECONNECT REQUIRED'", 15000, "the reloaded dashboard to learn of the run it does not control");
  await click(dashboard, "buildButton");
  await dashboard.waitFor("!document.getElementById('parserOverlay').hidden", 15000, "Build to open the Build Status panel after the reload");
  if (await dashboard.evaluate("document.getElementById('minimizeOverlay').getAttribute('aria-expanded') === 'false'")) await click(dashboard, "minimizeOverlay");
  await dashboard.waitFor("document.getElementById('rebindCollection').getClientRects().length > 0", 15000, "the dashboard to offer Reconnect run");
  assertStep(await dashboard.evaluate("['pauseCollection', 'resumeCollection', 'cancelCollection'].every((id) => document.getElementById(id).getClientRects().length === 0)"), "A dashboard that does not own the run must not offer its controls.");
  await waitForState((state) => state.status === "running", 8000, "the run to keep running while the reloaded page only reads its status");
  // Reconnect is the take-over: it pauses the run, binds it to this page and resumes it.
  const atReconnect = account.requests.length;
  await click(dashboard, "rebindCollection");
  held.release();
  await waitForState((state) => state.status === "running", 8000, "the reconnected run to resume");
  await waitForSavedDialog(dashboard, 180000);
  const documents = await waitForDownloads(savedBefore + 1);
  assertCompleteDocument(JSON.parse(documents.find((entry) => entry.name.includes("ReconnectCitizen")).text), account);
  return { requestsAtReconnect: atReconnect, requests: account.requests.length };
}

import assert from "node:assert/strict";
import { dashboard, extensionPage, rsi, setDashboard, setExtensionPage } from "./browser-pages-and-account-in-use.mjs";
import { asksForApproval, waitForChooser } from "./build-chooser.mjs";
import { displayedPath } from "./dashboard-copy-without-image-spacing.mjs";
import { openDashboard, startBuild } from "./dashboard-pages-and-builds.mjs";
import { clickExpression, localDashboardTabId, openExtensionPage } from "./page-clicks-and-extension-pages.mjs";
import { assertStep } from "./scenario-runner.mjs";

export async function revokeLocalApproval() {
  const before = rsi.requests.length;
  // The popup is opened on the tab that shows the dashboard now.
  const shownIn = await localDashboardTabId();
  assertStep(Number.isSafeInteger(shownIn), "No tab shows the local dashboard.");
  await extensionPage.close();
  setExtensionPage(await openExtensionPage(shownIn));
  await extensionPage.waitFor("document.readyState === 'complete' && document.querySelectorAll('#localList li').length === 1", 8000, "the popup to list the allowed dashboard");
  assert.equal(await extensionPage.evaluate("document.querySelector('#localList li span').textContent"), displayedPath);
  await extensionPage.waitFor("!document.getElementById('approvalView').hidden && document.getElementById('approvalView').dataset.state === 'allowed'", 8000, "the connected card before the approval is removed");
  await clickExpression(extensionPage, "document.querySelector('#localList button')");
  await extensionPage.waitFor("document.querySelectorAll('#localList li').length === 0", 8000, "the approval to be removed");
  // The connected card goes with the approval.
  await extensionPage.waitFor("document.getElementById('approvalView').hidden", 8000, "the connected card to go once the approval is removed");
  // The open tab is refused from its next request on; it is not left connected until reload.
  await startBuild(dashboard);
  await dashboard.waitFor("document.getElementById('messageDialog').open", 15000, "the refused build to be reported");
  const refusal = await dashboard.evaluate("({ title: document.getElementById('dialogTitle').textContent, message: document.getElementById('dialogMessage').textContent })");
  assertStep(/approved Star Citizen Data Downloader location/u.test(refusal.message), `A revoked local copy was not refused: ${JSON.stringify(refusal)}`);
  assert.equal(rsi.requests.length, before, "A revoked local copy caused an RSI request.");
  await dashboard.close();
  setDashboard(await openDashboard());
  await waitForChooser(dashboard, asksForApproval, "the revoked dashboard to need approval again");
  return { refusal: refusal.title };
}

import { chrome, dashboard, setDashboard } from "./browser-pages-and-account-in-use.mjs";
import { offersAccount, openChooser, waitForChooser } from "./build-chooser.mjs";
import { dashboardUrl } from "./dashboard-copy-without-image-spacing.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { assertStep } from "./scenario-runner.mjs";

export async function openDashboard(url = dashboardUrl) {
  const page = await chrome.newPage("about:blank");
  await page.navigate(url);
  // Rows are present as soon as the example, or a result handed over by the extension, is on screen.
  await page.waitFor("document.readyState === 'complete' && document.querySelectorAll('#inventoryRows tr').length > 0", 20000, "the dashboard to load");
  return page;
}

// Chrome lets a page start one download without a click and asks before a second, so each backup gets its own tab.
export async function freshDashboard() {
  if (dashboard) await dashboard.close();
  setDashboard(await openDashboard());
  await waitForChooser(dashboard, offersAccount, "the dashboard to connect to the extension");
  return dashboard;
}

export async function startBuild(page) {
  const state = await openChooser(page);
  assertStep(offersAccount(state), `The Build chooser did not offer the account backup: ${JSON.stringify(state)}`);
  await click(page, "buildAccountAction");
}

export async function waitForSavedDialog(page, timeoutMs) {
  await page.waitFor("document.getElementById('messageDialog').open || document.getElementById('overlaySummary').textContent === 'FAILED'", timeoutMs, "the account backup to finish");
  const outcome = await page.evaluate("({ title: document.getElementById('dialogTitle').textContent, message: document.getElementById('dialogMessage').textContent, summary: document.getElementById('overlaySummary').textContent, state: "
    + "document.getElementById('overlayState').textContent, detail: document.getElementById('overlayDetail').textContent, log: document.getElementById('eventLog').textContent.slice(0, 600) })");
  assertStep(outcome.title === "Account backup saved", `The backup did not finish and save: ${JSON.stringify(outcome)}`);
  await page.evaluate("document.getElementById('messageDialog').close()");
  return outcome;
}

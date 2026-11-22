import { click } from "./page-clicks-and-extension-pages.mjs";
import { POLL_MS, pause } from "./polling-intervals.mjs";

const chooserState = `(() => {
  const shown = (id) => document.getElementById(id).getClientRects().length > 0;
  return { notice: shown("extensionNotice"), title: document.getElementById("extensionNoticeTitle").textContent, install: shown("installExtensionAction"), account: shown("buildAccountAction"),
    accountDisabled: document.getElementById("buildAccountAction").disabled };
})()`;

// Presses Build and reads the chooser in the same turn of the page: Build opens it at once, and a status render that
// lands later hands the panel back to the status, so a separate wait could miss a chooser that did open. Build is
// pressed again, at most for 8 seconds, while the page shows something else, such as a status of a run in progress.
export async function openChooser(page) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const response = await page.send("Runtime.evaluate", { expression: `(() => { document.getElementById("buildButton").click();
      const open = !document.getElementById("parserOverlay").hidden && !document.getElementById("buildChoices").hidden;
      return { open, shown: { summary: document.getElementById("overlaySummary").textContent, dialog: document.getElementById("messageDialog").open }, ...${chooserState} }; })()`, returnByValue: true, userGesture: true });
    const { open, shown, ...state } = response.result.value;
    if (open) return state;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the Build chooser to open: ${JSON.stringify(shown)}`);
    await pause(POLL_MS);
  }
}

async function closeChooser(page) {
  await click(page, "closeOverlay");
  await page.waitFor("document.getElementById('parserOverlay').hidden", 8000, "the Build Status panel to close");
}

// Reopens the chooser until it reaches the wanted state; the bridge connects a moment after the page loads.
export async function waitForChooser(page, wanted, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await openChooser(page);
    await closeChooser(page);
    if (wanted(state)) return state;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state)}`);
    await pause(POLL_MS);
  }
}

export const offersAccount = (state) => state.account && !state.accountDisabled && !state.notice && !state.install;
export const asksForApproval = (state) => state.notice && state.title === "Allow this local copy" && !state.account && !state.install;

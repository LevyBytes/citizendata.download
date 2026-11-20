import { click } from "./page-clicks-and-extension-pages.mjs";
import { POLL_MS, pause } from "./polling-intervals.mjs";

const chooserState = `(() => {
  const shown = (id) => document.getElementById(id).getClientRects().length > 0;
  return { notice: shown("extensionNotice"), title: document.getElementById("extensionNoticeTitle").textContent, install: shown("installExtensionAction"), account: shown("buildAccountAction"),
    accountDisabled: document.getElementById("buildAccountAction").disabled };
})()`;

export async function openChooser(page) {
  await click(page, "buildButton");
  await page.waitFor("!document.getElementById('parserOverlay').hidden && !document.getElementById('buildChoices').hidden", 8000, "the Build chooser to open");
  return page.evaluate(chooserState);
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

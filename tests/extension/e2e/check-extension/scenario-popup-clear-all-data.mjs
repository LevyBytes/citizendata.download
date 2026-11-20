import assert from "node:assert/strict";
import { extensionOrigin, extensionPage, setRecoveryBackup } from "./browser-pages-and-account-in-use.mjs";
import { only } from "./options-and-run-folders.mjs";
import { STATE_KEY } from "./origins-keys-and-stand-in-image.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { assertStep } from "./scenario-runner.mjs";

export async function popupClearAllData() {
  await extensionPage.navigate(`${extensionOrigin}/popup/popup.html`);
  await extensionPage.waitFor("document.readyState === 'complete' && /^(Ready|RSI|Extension)/u.test(document.getElementById('stateTitle').textContent)", 8000, "the popup to load");
  const kept = () => extensionPage.evaluate("Promise.all([chrome.storage.local.get(null), chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'EXPORT_BACKUP' }), chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: "
    + "'GET_BUILD_HISTORY' })]).then(([local, exported, history]) => ({ keys: Object.keys(local).sort(), snapshots: exported.backup.stores.snapshots.length, jobs: exported.backup.stores.jobs.length, keptBuilds: history.copies.length }))");
  const before = await kept();
  setRecoveryBackup((await extensionPage.evaluate("chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'EXPORT_BACKUP' })")).backup);
  assertStep(before.snapshots >= 1 && before.jobs >= 1 && before.keys.includes(STATE_KEY), `There was nothing stored to clear: ${JSON.stringify(before)}`);
  // When the build history scenarios ran, a kept build and the history setting are there to be cleared too.
  if (!only) assertStep(before.keptBuilds === 1 && before.keys.includes("citizendata.buildHistory.v1"), `The kept build and the history setting were not there to clear: ${JSON.stringify(before)}`);
  // The first click only arms the button.
  await click(extensionPage, "clearAllData");
  assert.deepEqual(await extensionPage.evaluate("({ pressed: document.getElementById('clearAllData').getAttribute('aria-pressed'), label: document.getElementById('clearAllData').textContent })"), { pressed: "true", label: "Confirm clear all local data" });
  assert.deepEqual(await kept(), before, "One click must not clear anything.");
  await click(extensionPage, "clearAllData");
  await extensionPage.waitFor("document.getElementById('notice').textContent === 'All local CitizenData extension data was cleared.'", 8000, "the popup to confirm the clear");
  assert.deepEqual(await kept(), { keys: [], snapshots: 0, jobs: 0, keptBuilds: 0 }, "Clearing must remove saved backups, kept builds, jobs, state, the history setting, and local dashboard approvals.");
  assert.equal(await extensionPage.evaluate("document.getElementById('clearAllData').getAttribute('aria-pressed')"), "false");
  return before;
}

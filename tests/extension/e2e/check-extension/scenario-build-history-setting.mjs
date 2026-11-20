import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { extensionPage } from "./browser-pages-and-account-in-use.mjs";
import { out } from "./options-and-run-folders.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { enterKeep, historyState, noticeIs, reloadPopup } from "./popup-build-history-readings-and-actions.mjs";
import { assertStep } from "./scenario-runner.mjs";

export async function buildHistorySetting() {
  await reloadPopup();
  const initial = await historyState();
  assert.deepEqual({ stored: initial.stored, settings: initial.settings, checked: initial.checked, keep: initial.keep, keepDisabled: initial.keepDisabled, summary: initial.summary, rows: initial.rows, question: initial.question },
    {
      stored: null, settings: { enabled: true, keep: 5 }, checked: true, keep: "5", keepDisabled: false,
      summary: "No earlier build is kept yet. One is kept the next time a build differs from the one before.", rows: [], question: null
    }, "The build history must start on, at five copies, with nothing kept.");
  // The storage line states the amount stored and that Chrome does not clear it, which the permission provides.
  assertStep(
    /^[0-9.,]+ (bytes|KB|MB|GB) is stored in this browser\. Chrome does not clear it when the disk runs low\. Every build is also saved as a file on your device\.$/u.test(initial.storage),
    `The storage line did not state the amount stored and its protection: ${initial.storage}`
  );
  assert.equal(await extensionPage.evaluate("chrome.runtime.getManifest().permissions.includes('unlimitedStorage')"), true);

  // Turned off, it is stored as off and the number to keep is not offered; turned on again, it is as it was.
  await click(extensionPage, "historyEnabled");
  await noticeIs("Build history is off. Only the latest build is kept.");
  const off = await historyState();
  assert.deepEqual({ stored: off.stored, checked: off.checked, keepDisabled: off.keepDisabled, summary: off.summary, question: off.question },
    { stored: { enabled: false, keep: 5 }, checked: false, keepDisabled: true, summary: "No earlier build is kept.", question: null });
  await click(extensionPage, "historyEnabled");
  await noticeIs("Build history is on.");
  await enterKeep("3");
  await noticeIs("Keeping 3 earlier builds.");
  // A number outside 1 to 100, or not a whole number, changes nothing.
  for (const refused of ["0", "101", "2.5", ""]) {
    await enterKeep(refused);
    await noticeIs("Enter a whole number from 1 to 100.");
    await extensionPage.waitFor("document.getElementById('historyKeep').value === '3'", 8000, "the stored number to be shown again");
  }
  const on = await historyState();
  assert.deepEqual({ stored: on.stored, checked: on.checked, keep: on.keep, keepDisabled: on.keepDisabled, summary: on.summary, rows: on.rows },
    { stored: { enabled: true, keep: 3 }, checked: true, keep: "3", keepDisabled: false, summary: "No earlier build is kept yet. One is kept the next time a build differs from the one before.", rows: [] });
  await writeFile(path.join(out, "popup-build-history-on.png"), await extensionPage.screenshot());
  return { storage: on.storage };
}

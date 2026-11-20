import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dashboard, rsi } from "./browser-pages-and-account-in-use.mjs";
import { KEPT_STATE, assertCompleteDocument } from "./complete-document-expectations.mjs";
import { freshDashboard, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { out } from "./options-and-run-folders.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { downloadedDocuments, waitForDownloads } from "./stored-state-alarms-and-saved-files.mjs";

export async function updateBackup() {
  const firstRunRequests = rsi.requests.length;
  await freshDashboard();
  // Build history is on, so the page that has just loaded opens the latest build by itself, in place of the
  // example: nothing is asked of RSI and nothing is saved again.
  await dashboard.waitFor("document.getElementById('accountHandle').textContent === 'SyntheticCitizen'", 15000, "the latest build to open in the dashboard that has just loaded");
  const reopened = await dashboard.evaluate("({ eyebrow: document.getElementById('snapshotEyebrow').textContent, file: document.getElementById('railExported').textContent, toast: document.getElementById('statusToast').textContent, dialog: "
    + "document.getElementById('messageDialog').open, hangar: document.getElementById('hangarTabCount').textContent })");
  const firstBuild = JSON.parse((await downloadedDocuments()).at(-1).text);
  assert.deepEqual(
    reopened,
    { eyebrow: "LOADED ACCOUNT SNAPSHOT", file: (await downloadedDocuments()).at(-1).name, toast: "Your latest build, kept in the extension, is open.", dialog: false, hangar: String(firstBuild.pledges.length) },
    "The dashboard that has just loaded did not open the latest build."
  );
  assert.equal(rsi.requests.length, firstRunRequests, "Opening the kept build asked RSI for something.");
  assert.equal((await downloadedDocuments()).length, 1, "Opening the kept build saved a file again.");
  rsi.addPledges(3);
  // RSI also stops listing one buy-back and writes nothing about it to the Hangar Log.
  const gone = rsi.state.buybacks.filter((buyback) => !buyback.upgrade)[4];
  rsi.removeSilently("buybacks", gone.id);
  await startBuild(dashboard);
  const saved = await waitForSavedDialog(dashboard, 120000);
  const documents = await waitForDownloads(2);
  const document = JSON.parse(documents.at(-1).text);
  assertCompleteDocument(document, rsi);
  // The buy-back is kept in the backup as not reconcilable, the saved message says so, and the dashboard shows it
  // first in the buy-back list in its own row.
  assert.deepEqual(
    document.buybacks.filter((record) => record.state === KEPT_STATE).map((record) => [record.buybackId, record.state, record.removal.returnedAt]),
    [[gone.id, "not-reconcilable", null]], "The buy-back RSI stopped listing was not kept as not reconcilable."
  );
  assert.deepEqual(document.sync.removalTracking.buybacks, { status: "compared", reason: null, missing: 1, explained: 0, notReconcilable: 1, returned: 0, kept: 1 });
  assert.deepEqual(document.sync.removalTracking.pledges, { status: "compared", reason: null, missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept: 0 });
  assertStep(saved.message.includes("1 potential ghost removal") && saved.message.includes("Keep your earlier backup files"), `The saved message did not report the removal or the advice to keep earlier backups: ${saved.message}`);
  const shown = await dashboard.evaluate(`(() => {
    document.querySelector('[data-view="buybacks"]').click();
    const row = document.querySelector('#inventoryRows tr');
    return { classes: [...row.classList], label: row.querySelector('.state-label').textContent, title: row.querySelector('.record-button b').textContent, background: getComputedStyle(row.querySelector('td')).backgroundColor };
  })()`);
  assertStep(shown.classes.includes("record-ghost") && shown.label === "POTENTIAL GHOST REMOVAL" && shown.title === gone.title, `The dashboard did not show the removed buy-back first in its own row: ${JSON.stringify(shown)}`);
  await writeFile(path.join(out, "dashboard-potential-ghost-removal.png"), await dashboard.screenshot());
  const used = rsi.requests.length - firstRunRequests;
  assertStep(used < firstRunRequests, `An update after three new pledges used ${used} requests; the first full run used ${firstRunRequests}.`);
  assert.equal(document.sync.runs.length, 2, "The updated backup must record both runs.");
  return { requests: used, firstRunRequests, pledges: document.pledges.length };
}

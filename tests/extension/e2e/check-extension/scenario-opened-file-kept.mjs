import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dashboard, extensionPage, rsi, setDashboard } from "./browser-pages-and-account-in-use.mjs";
import { asksForApproval, offersAccount, waitForChooser } from "./build-chooser.mjs";
import { freshDashboard, openDashboard } from "./dashboard-pages-and-builds.mjs";
import { heldSnapshots, keepChosenImagesZip, keepChosenOrgsJson, openBackupFile, popupRequest } from "./opened-file-page-actions.mjs";
import { options } from "./options-and-run-folders.mjs";
import { QUIET_MS, pause } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { downloadedDocuments } from "./stored-state-alarms-and-saved-files.mjs";

export async function openedFileKept() {
  // An extension that holds nothing, as after a fresh installation, and a backup file an earlier scenario saved.
  // With --open-file, the file is one on disk, chosen in the file input as a user chooses it. That is how a
  // backup of a real account's size is tried; only its length is reported.
  const saved = (await downloadedDocuments()).map((file) => ({ ...file, document: JSON.parse(file.text) })).sort((left, right) => left.document.exportedAt.localeCompare(right.document.exportedAt));
  const chosen = options["open-file"] ? path.resolve(options["open-file"]) : null;
  assertStep(chosen || saved.length >= 1, "This scenario opens a backup an earlier scenario saved; run it together with full-backup, or pass --open-file.");
  const file = chosen ? await readFile(chosen, "utf8").then((text) => ({ name: path.basename(chosen), text, document: JSON.parse(text) })) : saved.at(-1);
  const openFile = () => openBackupFile(chosen, file);
  assert.equal((await popupRequest("CLEAR_ALL")).ok, true);
  assert.deepEqual(await heldSnapshots(), []);
  const before = rsi.requests.length;

  // The local copy is allowed again, and shows the example: the extension has no build to hand it.
  await dashboard.close();
  setDashboard(await openDashboard());
  const connection = await waitForChooser(dashboard, (state) => asksForApproval(state) || offersAccount(state), "the local copy to connect or to ask for approval");
  if (asksForApproval(connection)) {
    const tabs = await extensionPage.evaluate("chrome.storage.session.get('citizendata.localPending.v1').then((stored) => Object.keys(stored['citizendata.localPending.v1'] ?? {}).map(Number))");
    assert.equal(await extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'APPROVE_LOCAL_DASHBOARD', tabId: ${tabs.at(-1)} }).then((response) => response.ok)`), true);
  }
  await freshDashboard();
  await pause(QUIET_MS);
  assert.equal(await dashboard.evaluate("document.getElementById('snapshotEyebrow').textContent"), "EXAMPLE ACCOUNT");

  // The user opens the file with Load JSON. Nothing else is done: the extension takes it in.
  const startedOpening = Date.now();
  await openFile();
  await dashboard.waitFor("document.getElementById('messageDialog').open && document.getElementById('dialogMessage').textContent.includes('The extension ')", 120000, "the backup file to open and the extension to answer");
  const secondsToKeep = Number(((Date.now() - startedOpening) / 1000).toFixed(1));
  const opened = await dashboard.evaluate("({ title: document.getElementById('dialogTitle').textContent, message: document.getElementById('dialogMessage').textContent })");
  assert.deepEqual(
    opened,
    { title: "Account file verified", message: "Your file passed the canonical schema and SHA-256 integrity checks. It is open on this device; nothing was uploaded or saved by the website. The extension now keeps this file as your latest build." }
  );
  await dashboard.evaluate("document.getElementById('messageDialog').close()");
  assert.deepEqual(await heldSnapshots(), [[file.document.account.handle, file.document.integrity.contentHash]], "The extension does not hold the opened file as the account's build.");

  // A page that loads now is shown the account, and opening the same file again changes nothing.
  const startedReload = Date.now();
  await freshDashboard();
  await dashboard.waitFor(`document.getElementById('accountHandle').textContent === ${JSON.stringify(file.document.account.handle)}`, 120000, "the kept build to open in the dashboard that has just loaded");
  const secondsToReopen = Number(((Date.now() - startedReload) / 1000).toFixed(1));
  assert.equal(await dashboard.evaluate("document.getElementById('statusToast').textContent"), "Your latest build, kept in the extension, is open.");
  await openFile();
  await dashboard.waitFor("document.getElementById('messageDialog').open && document.getElementById('dialogMessage').textContent.includes('The extension ')", 120000, "the backup file to open a second time and the extension to answer");
  assertStep((await dashboard.evaluate("document.getElementById('dialogMessage').textContent")).endsWith("The extension already keeps this build."), "Opening the kept file again was not reported as already kept.");
  await dashboard.evaluate("document.getElementById('messageDialog').close()");
  // With --open-orgs and --open-zip, the Orgs JSON and the Images ZIP that belong to the chosen account file are
  // chosen in their inputs too. Only counts are reported.
  const others = {};
  if (chosen && options["open-orgs"]) await keepChosenOrgsJson(others);
  if (chosen && options["open-zip"]) await keepChosenImagesZip(others, file);
  assert.equal(rsi.requests.length, before, "Taking in an opened file asked RSI for something.");
  assert.equal((await downloadedDocuments()).length, saved.length, "Taking in an opened file saved a file.");

  // The extension is left empty, as the scenario before left it.
  assert.equal((await popupRequest("CLEAR_ALL")).ok, true);
  await dashboard.close();
  setDashboard(await openDashboard());
  await waitForChooser(dashboard, asksForApproval, "the local copy to need approval again");
  return { characters: file.text.length, secondsToKeep, secondsToReopen, ...others };
}

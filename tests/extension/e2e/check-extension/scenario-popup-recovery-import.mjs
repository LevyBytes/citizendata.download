import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dashboard, extensionOrigin, extensionPage, recoveryBackup, setDashboard } from "./browser-pages-and-account-in-use.mjs";
import { asksForApproval, offersAccount, waitForChooser } from "./build-chooser.mjs";
import { openDashboard } from "./dashboard-pages-and-builds.mjs";
import { options, out, scratch } from "./options-and-run-folders.mjs";
import { assertStep } from "./scenario-runner.mjs";

export async function popupRecoveryImport() {
  // A recovery backup is chosen in the popup's file input as a user chooses it, into an extension that holds
  // nothing. With --import-recovery, the file is one on disk; only counts of it are reported.
  const request = (type) => extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: '${type}' })`);
  const counts = (backup) => Object.fromEntries(Object.entries(backup.stores).map(([name, rows]) => [name, rows.length]));
  let filePath = options["import-recovery"] ? path.resolve(options["import-recovery"]) : null;
  let expected;
  if (filePath) {
    expected = counts(JSON.parse(await readFile(filePath, "utf8")));
  } else {
    const backup = recoveryBackup ?? (await request("EXPORT_BACKUP")).backup;
    expected = counts(backup);
    filePath = path.join(scratch, "recovery-to-import.json");
    await writeFile(filePath, JSON.stringify(backup, null, 2));
  }
  assert.equal((await request("CLEAR_ALL")).ok, true);
  await extensionPage.navigate(`${extensionOrigin}/popup/popup.html`);
  await extensionPage.waitFor("document.readyState === 'complete' && /^(Ready|RSI|Extension)/u.test(document.getElementById('stateTitle').textContent)", 8000, "the popup to load");
  assert.equal(Object.values(counts((await request("EXPORT_BACKUP")).backup)).reduce((sum, count) => sum + count, 0), 0, "The extension must hold nothing before the import.");
  // Every section of the popup is open, so the end of the popup is far below what is in view.
  await extensionPage.evaluate("(() => { for (const section of document.querySelectorAll('#popupMain details')) section.open = true; document.getElementById('importBackup').closest('details').scrollIntoView({ block: 'start' }); })()");
  const scrolledTo = await extensionPage.evaluate("document.getElementById('popupMain').scrollTop");
  const started = Date.now();
  const input = await extensionPage.send("Runtime.evaluate", { expression: "document.getElementById('importBackup')" });
  await extensionPage.send("DOM.setFileInputFiles", { files: [filePath], objectId: input.result.objectId });
  await extensionPage.waitFor("document.getElementById('notice').textContent !== ''", 180000, "the popup to say what the import did");
  const shown = await extensionPage.evaluate(`(() => {
    const notice = document.getElementById('notice');
    const box = notice.getBoundingClientRect();
    const main = document.getElementById('popupMain');
    // In view: inside the window, and the topmost element at its own middle, so nothing covers it.
    const inView = box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === notice;
    return { notice: notice.textContent, inView, scrolledTo: main.scrollTop, belowTheView: main.scrollHeight - main.clientHeight - main.scrollTop };
  })()`);
  await extensionPage.screenshot().then((image) => writeFile(path.join(out, "popup-recovery-import.png"), image));
  const held = counts((await request("EXPORT_BACKUP")).backup);
  const detail = { ...shown, seconds: Number(((Date.now() - started) / 1000).toFixed(1)), megabytes: Number(((await stat(filePath)).size / 1048576).toFixed(1)), held };
  assert.equal(shown.notice, "Recovery backup restored.", `The import was not confirmed: ${JSON.stringify(detail)}`);
  assert.deepEqual(held, expected, "The extension must hold what the recovery backup held.");
  assertStep(shown.inView, `The confirmation was outside the popup's view: ${JSON.stringify(detail)}`);
  assert.equal(shown.scrolledTo, scrolledTo, "Showing the confirmation must not move what is under the pointer.");
  // A dashboard that loads now is shown the newest restored build. The clear removed this copy's approval.
  const snapshot = (await request("EXPORT_BACKUP")).backup.stores.snapshots
    .filter((entry) => typeof entry?.document?.exportedAt === "string" && typeof entry.document.account?.handle === "string")
    .sort((left, right) => right.document.exportedAt.localeCompare(left.document.exportedAt))[0];
  if (snapshot) {
    await dashboard.close();
    setDashboard(await openDashboard());
    const connection = await waitForChooser(dashboard, (state) => asksForApproval(state) || offersAccount(state), "the local copy to connect or to ask for approval");
    if (asksForApproval(connection)) {
      const tabs = await extensionPage.evaluate("chrome.storage.session.get('citizendata.localPending.v1').then((stored) => Object.keys(stored['citizendata.localPending.v1'] ?? {}).map(Number))");
      assert.equal(await extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'APPROVE_LOCAL_DASHBOARD', tabId: ${tabs.at(-1)} }).then((response) => response.ok)`), true);
    }
    // Ready: a dashboard that has just loaded shows the restored build, which it can only fetch once the bridge is
    // connected. Only then is the chooser asked for.
    await dashboard.close();
    setDashboard(await openDashboard());
    await dashboard.waitFor(`document.getElementById('accountHandle').textContent === ${JSON.stringify(snapshot.document.account.handle)}`, 120000, "the restored build to open in a dashboard that has just loaded");
    await waitForChooser(dashboard, offersAccount, "the dashboard with the restored build to offer a build");
    detail.dashboardShowsRestoredBuild = true;
  } else {
    detail.dashboardShowsRestoredBuild = "no build in the backup";
  }
  return detail;
}

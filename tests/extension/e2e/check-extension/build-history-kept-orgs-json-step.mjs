import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { extensionPage } from "./browser-pages-and-account-in-use.mjs";
import { out } from "./options-and-run-folders.mjs";
import { click, clickExpression } from "./page-clicks-and-extension-pages.mjs";
import { historyState, noticeIs, reloadPopup } from "./popup-build-history-readings-and-actions.mjs";
import { assertStep } from "./scenario-runner.mjs";

export async function keptOrgsJsonIsListedSavedAndDeleted(first, second) {
  // A kept Orgs JSON is listed first, by name, and is saved and deleted like a kept build. The roster run that
  // makes one is covered under Node; here the record a roster run stores is written straight into the extension's
  // database, and the popup is checked against it.
  const keptOrgs = await extensionPage.evaluate(`(async () => {
    const exportedAt = '2026-10-01T10:00:00.000Z';
    const organizations = { schemaVersion: 1, documentType: 'CitizenDataOrganizations', generator: { name: 'CitizenData', version: chrome.runtime.getManifest().version }, exportedAt,
      account: { localAccountId: '11111111-1111-4111-8111-111111111111', handle: 'SyntheticCitizen' }, memberships: [{ sid: 'SYNTH' }],
      rosterIndex: [{ organizationSid: 'SYNTH', memberStart: 0, memberCount: 2, status: 'complete', updatedAt: exportedAt }],
      members: [{ recordKey: 'member-1', organizationSid: 'SYNTH' }, { recordKey: 'member-2', organizationSid: 'SYNTH' }], sync: { runs: [] }, integrity: { algorithm: 'SHA-256', contentHash: '0'.repeat(64) } };
    const planned = await CitizenDataBuildHistory.planOrganizations({ settings: { enabled: true, keep: 5 }, accountId: 'SyntheticCitizen', organizations, archivedAt: exportedAt });
    const database = await new Promise((resolve, reject) => { const opening = indexedDB.open('citizendata.jobs.v1'); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['history', 'historyData'], 'readwrite');
      transaction.objectStore('history').put(planned.entry);
      transaction.objectStore('historyData').put(planned.data);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return { historyId: planned.entry.historyId, fileName: planned.entry.fileName, text: JSON.stringify(organizations, null, 2) + '\\n' };
  })()`);
  await reloadPopup();
  const withOrgs = await historyState();
  assertStep(withOrgs.rows.length === 3 && withOrgs.rows[0].when === "Orgs JSON" && /^updated .+, .+ file, .+ stored$/u.test(withOrgs.rows[0].detail) && withOrgs.rows[0].buttons.join("/") === "Save/Delete" && withOrgs.rows[1].when !== "Orgs JSON",
    `The popup did not list the kept Orgs JSON first: ${JSON.stringify(withOrgs.rows)}`);
  assertStep(/^2 earlier builds and the Orgs JSON kept, .* stored\.$/u.test(withOrgs.summary) && withOrgs.copies.length === 3, `The summary does not name the kept Orgs JSON: ${withOrgs.summary}`);
  assert.deepEqual(await extensionPage.evaluate("[...document.querySelectorAll('#historyList li')[0].querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))"), ["Save the Orgs JSON as a file", "Delete the kept Orgs JSON"]);
  await writeFile(path.join(out, "popup-build-history-orgs-json.png"), await extensionPage.screenshot());
  const savedOrgs = await extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'GET_BUILD_HISTORY_COPY', historyId: ${JSON.stringify(keptOrgs.historyId)} }).then(async (response) => ({ fileName: response.copy.fileName, `
    + `text: new TextDecoder().decode(await CitizenDataBuildHistory.unpack(response.copy.gzipBase64)) }))`);
  assert.deepEqual(savedOrgs, { fileName: keptOrgs.fileName, text: keptOrgs.text }, "The kept Orgs JSON does not give back its own file.");
  assert.equal(keptOrgs.fileName, "citizendata-organizations-SyntheticCitizen-2026-10-01-100000-000Z.json");
  // With the history off, the question names it too. Then it is deleted by itself, with a second click.
  await click(extensionPage, "historyEnabled");
  await noticeIs("Build history is off.");
  const askedWithOrgs = await historyState();
  assert.equal(askedWithOrgs.question, "Build history is off. 2 earlier builds and the Orgs JSON are still kept. Delete them?");
  assert.equal(await extensionPage.evaluate("document.getElementById('historyDeleteAll').textContent"), "Delete what is kept");
  await click(extensionPage, "historyKeepAll");
  await click(extensionPage, "historyEnabled");
  await noticeIs("Build history is on.");
  const orgsDelete = "document.querySelectorAll('#historyList li')[0].querySelector('button.danger')";
  await clickExpression(extensionPage, orgsDelete);
  await clickExpression(extensionPage, orgsDelete);
  await extensionPage.waitFor("document.querySelectorAll('#historyList li').length === 2", 8000, "the deleted Orgs JSON to leave the list");
  await noticeIs("The kept Orgs JSON was deleted.");
  assert.deepEqual((await historyState()).copies.map((copy) => copy.exportedAt), [second.document.exportedAt, first.document.exportedAt], "Deleting the Orgs JSON must leave the kept builds.");
  assert.equal(await extensionPage.evaluate("document.getElementById('historyDeleteAll').textContent"), "Delete the kept builds");
}

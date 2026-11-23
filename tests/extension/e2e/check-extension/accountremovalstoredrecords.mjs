import assert from "node:assert/strict";
import { dashboard, extensionOrigin, extensionPage, setDashboard } from "./browser-pages-and-account-in-use.mjs";
import { asksForApproval, offersAccount, waitForChooser } from "./build-chooser.mjs";
import { openDashboard } from "./dashboard-pages-and-builds.mjs";

// The account-removal scenario starts from nothing: Clear All, from the popup, which removes the local copy's approval
// too, so the copy is allowed again, as opened-file-kept does.
export async function clearAllAndAllowTheLocalCopy() {
  await extensionPage.navigate(`${extensionOrigin}/popup/popup.html`);
  await extensionPage.waitFor("document.readyState === 'complete' && typeof CitizenDataBuildHistory === 'object'", 8000, "the popup to load");
  assert.equal((await extensionPage.evaluate("chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'CLEAR_ALL' })")).ok, true);
  if (dashboard) await dashboard.close();
  setDashboard(await openDashboard());
  if (asksForApproval(await waitForChooser(dashboard, (state) => asksForApproval(state) || offersAccount(state), "the local copy to connect or to ask for approval"))) {
    const tabs = await extensionPage.evaluate("chrome.storage.session.get('citizendata.localPending.v1').then((stored) => Object.keys(stored['citizendata.localPending.v1'] ?? {}).map(Number))");
    assert.equal(await extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'APPROVE_LOCAL_DASHBOARD', tabId: ${tabs.at(-1)} }).then((response) => response.ok)`), true);
  }
}

// The records of the account-removal scenario that no build in this check makes, written straight into the
// extension's IndexedDB from its page, as a roster run and an image run would store them: an Orgs JSON for each
// account, one image both accounts share, and the image hosts' pace history.
export function storeRecordsNoBuildMakes(handles) {
  return extensionPage.evaluate(`(async () => {
    const exportedAt = '2026-10-01T10:00:00.000Z';
    const orgs = (handle) => ({ schemaVersion: 1, documentType: 'CitizenDataOrganizations', generator: { name: 'CitizenData', version: chrome.runtime.getManifest().version }, exportedAt,
      account: { localAccountId: '11111111-1111-4111-8111-111111111111', handle }, memberships: [{ sid: 'SYNTH' }],
      rosterIndex: [{ organizationSid: 'SYNTH', memberStart: 0, memberCount: 1, status: 'complete', updatedAt: exportedAt }],
      members: [{ recordKey: 'member-1', organizationSid: 'SYNTH' }], sync: { runs: [] }, integrity: { algorithm: 'SHA-256', contentHash: '0'.repeat(64) } });
    const planned = [];
    for (const handle of ${JSON.stringify(handles)}) planned.push(await CitizenDataBuildHistory.planOrganizations({ settings: { enabled: true, keep: 5 }, accountId: handle, organizations: orgs(handle), archivedAt: exportedAt }));
    const database = await new Promise((resolve, reject) => { const opening = indexedDB.open('citizendata.jobs.v1'); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['history', 'historyData', 'media', 'mediaData', 'paceHistory'], 'readwrite');
      for (const { entry, data } of planned) {
        transaction.objectStore('history').put(entry);
        transaction.objectStore('historyData').put(data);
      }
      const assetId = 'a'.repeat(64);
      transaction.objectStore('media').put({ assetId, contentHash: 'b'.repeat(64), mediaType: 'image/png', byteLength: 4, pixelWidth: 1, pixelHeight: 1, fetchedAt: exportedAt, storedAt: exportedAt });
      transaction.objectStore('mediaData').put({ assetId, base64: 'iVBORw==' });
      transaction.objectStore('paceHistory').put({ historyKey: 'images', kind: 'images', version: 1, aggregate: { historyKey: 'images' }, runs: [] });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return planned.map(({ entry }) => entry.historyId);
  })()`);
}

// What the extension's IndexedDB holds after the removal, read through a connection of its own, opened after the
// worker was stopped and closed again; and the account list in the extension's local storage.
export function storedAfterRemoval() {
  return extensionPage.evaluate(`(async () => {
    const database = await new Promise((resolve, reject) => { const opening = indexedDB.open('citizendata.jobs.v1'); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
    const names = ['snapshots', 'history', 'historyData', 'jobs', 'stagedRuns', 'media', 'mediaData', 'paceHistory'];
    const transaction = database.transaction(names, 'readonly');
    const read = (name) => new Promise((resolve, reject) => { const all = transaction.objectStore(name).getAll(); all.onsuccess = () => resolve(all.result); all.onerror = () => reject(all.error); });
    const stores = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await read(name)])));
    database.close();
    const registry = (await chrome.storage.local.get('citizendata.accounts.v1'))['citizendata.accounts.v1'] ?? null;
    return {
      snapshots: stores.snapshots.map((record) => record.accountId).sort(),
      history: stores.history.map((entry) => [entry.accountId, entry.kind ?? 'build']).sort(),
      historyData: stores.historyData.length,
      incomplete: stores.jobs.filter((job) => ['cancelled', 'failed'].includes(job.status)).map((job) => [job.accountId, job.status, job.runId]),
      stagedRunIds: stores.stagedRuns.map((staged) => staged.runId),
      media: [stores.media.length, stores.mediaData.length],
      imagePaceHistory: stores.paceHistory.some((record) => record.historyKey === 'images'),
      registry: registry && { accounts: registry.accounts.map((entry) => entry.key), selectedKey: registry.selectedKey }
    };
  })()`);
}

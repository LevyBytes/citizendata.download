import { extensionOrigin, extensionPage } from "./browser-pages-and-account-in-use.mjs";

// The popup as the user finds it: history off, five copies, and the number greyed out until the history is on.
export const historyState = () => extensionPage.evaluate(`Promise.all([chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'GET_BUILD_HISTORY' }), chrome.storage.local.get('citizendata.buildHistory.v1')]).then(([status, stored]) => ({
  stored: stored['citizendata.buildHistory.v1'] ?? null,
  settings: status.settings,
  copies: status.copies.map((copy) => ({ historyId: copy.historyId, exportedAt: copy.exportedAt, fileName: copy.fileName, fileBytes: copy.fileBytes, storedBytes: copy.storedBytes })),
  storedBytes: status.storedBytes,
  problem: status.problem,
  checked: document.getElementById('historyEnabled').checked,
  keep: document.getElementById('historyKeep').value,
  keepDisabled: document.getElementById('historyKeep').disabled,
  summary: document.getElementById('historySummary').textContent,
  rows: [...document.querySelectorAll('#historyList li')].map((row) => ({ when: row.querySelector('.history-'
    + 'when').firstChild.textContent, detail: row.querySelector('small').textContent, buttons: [...row.querySelectorAll('button')].map((button) => button.textContent) })),
  // What is shown, not the attribute: the hidden attribute must hide the question's group although its class sets display.
  question: getComputedStyle(document.getElementById('historyOffQuestion')).display === 'none' ? null : document.getElementById('historyOffText').textContent,
  recoveryNote: !document.getElementById('historyRecoveryNote').hidden,
  storage: document.getElementById('storageState').textContent,
  notice: document.getElementById('notice').textContent
}))`);
export const reloadPopup = async () => {
  await extensionPage.navigate(`${extensionOrigin}/popup/popup.html`);
  await extensionPage.waitFor(
    "document.readyState === 'complete' && /^(Ready|RSI|Extension)/u.test(document.getElementById('stateTitle').textContent) && document.getElementById('storageState').textContent !== 'Checking storage…'",
    8000, "the popup to load"
  );
  await extensionPage.evaluate("document.getElementById('buildHistory').open = true");
};
export const enterKeep = (value) => extensionPage.evaluate(`(() => { const input = document.getElementById('historyKeep'); input.focus(); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
export const noticeIs = (text) => extensionPage.waitFor(`document.getElementById('notice').textContent === ${JSON.stringify(text)}`, 8000, `the popup to say: ${text}`);

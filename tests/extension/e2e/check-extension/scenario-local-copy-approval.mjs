import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dashboard, dashboardTabId, extensionOrigin, extensionPage, setDashboard, setDashboardTabId, setExtensionPage } from "./browser-pages-and-account-in-use.mjs";
import { asksForApproval, offersAccount, waitForChooser } from "./build-chooser.mjs";
import { dashboardPath, displayedPath } from "./dashboard-copy-without-image-spacing.mjs";
import { openDashboard } from "./dashboard-pages-and-builds.mjs";
import { out } from "./options-and-run-folders.mjs";
import { click, openExtensionPage } from "./page-clicks-and-extension-pages.mjs";
import { QUIET_MS, pause } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";

export async function localCopyApproval() {
  setDashboard(await openDashboard());
  await waitForChooser(dashboard, asksForApproval, "an unapproved local copy to be told to ask for approval");

  const probe = await openExtensionPage();
  const pending = await probe.evaluate("chrome.storage.session.get('citizendata.localPending.v1').then((stored) => stored['citizendata.localPending.v1'] ?? {})");
  const pendingTabs = Object.keys(pending).map(Number);
  assertStep(pendingTabs.length === 1 && pending[pendingTabs[0]].path === dashboardPath, `The worker did not remember exactly this local dashboard as waiting: ${JSON.stringify(pending)}`);
  setDashboardTabId(pendingTabs[0]);
  assert.equal(await probe.evaluate(`chrome.action.getBadgeText({ tabId: ${dashboardTabId} })`), "!", "The toolbar icon did not mark the tab that needs approval.");
  // The popup supplies only a tab identifier. A tab with no waiting dashboard cannot be approved, and a path cannot be supplied.
  assert.deepEqual(await probe.evaluate("chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'APPROVE_LOCAL_DASHBOARD', tabId: 999999, path: '/C:/elsewhere/docs/index.html' })"), { ok: false, code: "NO_PENDING_LOCAL_DASHBOARD" });
  assert.deepEqual(await probe.evaluate("chrome.storage.local.get('citizendata.localDashboards.v1').then((stored) => stored['citizendata.localDashboards.v1'] ?? [])"), [], "A refused approval must store nothing.");
  await probe.close();

  setExtensionPage(await openExtensionPage(dashboardTabId));
  await extensionPage.waitFor("!document.getElementById('approvalView').hidden", 8000, "the approval card");
  const card = await extensionPage.evaluate("({ title: document.getElementById('approvalTitle').textContent, path: document.getElementById('approvalPath').textContent, embers: document.getElementById('approvalEmbers').width > 0, art: "
    + "getComputedStyle(document.getElementById('approvalArt')).backgroundImage.includes('radar.svg') })");
  assertStep(card.title === "Allow this local copy?" && card.embers && card.art && card.path === displayedPath, `The approval card did not show the dashboard's own path (${displayedPath}) with its artwork: ${JSON.stringify(card)}`);
  await writeFile(path.join(out, "popup-approval-card.png"), await extensionPage.screenshot());
  await click(extensionPage, "approveLocal");
  await extensionPage.waitFor("document.getElementById('approvalView').dataset.state === 'allowed'", 8000, "the approval to be stored");
  await writeFile(path.join(out, "popup-approved.png"), await extensionPage.screenshot());
  assert.equal(await extensionPage.evaluate(`chrome.action.getBadgeText({ tabId: ${dashboardTabId} })`), "", "The toolbar mark stayed after approval.");

  // Once the sections are taller than the popup's 600 pixels they scroll. The card keeps its whole height then, so
  // the path is never cut off. An opened section is enough to pass that height.
  const wholeCard = "(() => { const card = document.getElementById('approvalView'); const shown = document.getElementById('approvalPath'); return { cardClipped: card.scrollHeight - card.clientHeight, pathBelowCard: Math.round(shown.getBoundingClientRect()"
    + ".bottom - card.getBoundingClientRect().bottom), pathClipped: shown.scrollHeight - shown.clientHeight, lines: Math.round(shown.getBoundingClientRect().height), scrolls: document.getElementById('popupMain').scrollHeight > "
    + "document.getElementById('popupMain').clientHeight, text: shown.textContent }; })()";
  const longPath = `${displayedPath.replace(/index\.html$/u, "")}a folder with a long name\\another folder with a long name\\docs\\index.html`;
  await extensionPage.evaluate("(() => { document.querySelector('#popupMain > details').open = true; })()");
  for (const [label, shownPath] of [["scrolling", displayedPath], ["scrolling-long-path", longPath]]) {
    await extensionPage.evaluate(`(() => { document.getElementById('approvalPath').textContent = ${JSON.stringify(shownPath)}; document.getElementById('popupMain').scrollTop = 0; })()`);
    const measured = await extensionPage.evaluate(wholeCard);
    await writeFile(path.join(out, `popup-approved-${label}.png`), await extensionPage.screenshot());
    assertStep(measured.scrolls && measured.cardClipped <= 0 && measured.pathClipped <= 0 && measured.pathBelowCard < 0 && measured.text === shownPath, `The allowed card cut off its path once the popup scrolled (${label}): ${JSON.stringify(measured)}`);
  }
  await extensionPage.evaluate(`(() => { document.querySelector('#popupMain > details').open = false; document.getElementById('approvalPath').textContent = ${JSON.stringify(displayedPath)}; })()`);

  // The dashboard connects without a reload.
  await waitForChooser(dashboard, offersAccount, "the approved dashboard to be offered the account backup");

  // The card stays after the approval. Opened again on the allowed copy's tab, the popup shows it as connected,
  // with its artwork and embers, above the ordinary sections.
  await extensionPage.navigate(`${extensionOrigin}/popup/popup.html`);
  await extensionPage.waitFor("!document.getElementById('approvalView').hidden && document.getElementById('approvalView').dataset.state === 'allowed'", 8000, "the connected card when the popup is opened again");
  await extensionPage.waitFor("/rotate\\(/u.test(document.getElementById('approvalArt').style.transform)", 8000, "the connected card's artwork to turn");
  const reopened = await extensionPage.evaluate("({ eyebrow: document.getElementById('approvalEyebrow').textContent, title: document.getElementById('approvalTitle').textContent, lead: document.getElementById('approvalLead').textContent, path: "
    + "document.getElementById('approvalPath').textContent, actionsHidden: document.getElementById('approvalActions').hidden, noteHidden: document.getElementById('approvalNote').hidden, embers: document.getElementById('approvalEmbers').width > 0, "
    + "turning: /rotate\\(/u.test(document.getElementById('approvalArt').style.transform), sectionsShown: document.getElementById('openDashboard').getClientRects().length > 0, mode: document.getElementById('popupMain').dataset.mode ?? null })");
  assert.deepEqual(
    reopened,
    { eyebrow: "CONNECTED", title: "Local dashboard allowed", lead: "This copy is connected. Return to its tab and choose Build.", path: displayedPath, actionsHidden: true, noteHidden: true, embers: true, turning: true, sectionsShown: true, mode: null },
    "The popup did not keep the connected card when it was opened again on the allowed copy."
  );
  await writeFile(path.join(out, "popup-reopened-on-allowed-copy.png"), await extensionPage.screenshot());
  // On a tab that shows no local dashboard the popup has no card.
  const elsewhere = await openExtensionPage();
  await pause(QUIET_MS);
  assert.equal(await elsewhere.evaluate("document.getElementById('approvalView').hidden"), true, "The connected card was shown on a tab that is not a local dashboard.");
  await elsewhere.close();
  return { path: card.path };
}

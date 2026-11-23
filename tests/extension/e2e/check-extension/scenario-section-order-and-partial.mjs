import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createSyntheticRsi, dashboard, extensionPage, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { freshDashboard, selectCurrentRsiAccount, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { downloads } from "./options-and-run-folders.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { pause, POLL_MS } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { sectionOrderOf } from "./section-order-of-requests.mjs";

const HANDLE = "OrderCitizen";
const BUYBACK_PAGE = /^\/(en\/)?pledge\/buyback\/[0-9]+$/u;

function storedSnapshots() {
  return extensionPage.evaluate("chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'EXPORT_BACKUP' }).then(({ backup }) => backup.stores.snapshots.map((snapshot) => ({ accountId: snapshot.accountId, runId: snapshot.runId, handle: " +
    "snapshot.document?.account?.handle ?? null, status: snapshot.document?.sync?.runs?.at(-1)?.status ?? null })))");
}

async function partialFile() {
  for (const deadline = Date.now() + 15000; ;) {
    const name = (await readdir(downloads)).find((candidate) => candidate.includes(HANDLE) && candidate.includes("partial") && candidate.endsWith(".json"));
    if (name) return { name, text: await readFile(path.join(downloads, name), "utf8") };
    assertStep(Date.now() < deadline, "The partial backup was not saved.");
    await pause(POLL_MS);
  }
}

function assertCanonicalOrder(order, label) {
  assertStep(order.outOfOrder.length === 0, `${label} left the canonical section order: ${order.outOfOrder.join("; ")}`);
  assert.deepEqual(order.order.slice(0, 2), ["profile", "hangarLog"], `${label} did not read profile and then Hangar Log first: ${order.order.join(", ")}`);
}

// What the page shows from here on, recorded by the page: the panel's hidden state, its badge and its announcements.
const WATCH_PANEL = `(() => { const overlay = document.getElementById('parserOverlay'); const summary = document.getElementById('overlaySummary'); const announcer = document.getElementById('buildStatusAnnouncement');
  window.__partial = { shown: [], summaries: [], announced: [] };
  new MutationObserver(() => { if (!overlay.hidden) window.__partial.shown.push(summary.textContent); }).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => window.__partial.summaries.push(summary.textContent)).observe(summary, { childList: true, characterData: true, subtree: true });
  new MutationObserver(() => window.__partial.announced.push(announcer.textContent)).observe(announcer, { childList: true, characterData: true, subtree: true });
  return true; })()`;

// The canonical section order and the partial artifact (PARSER_HARDENING.md §4.8, §10, §11.4, §15.5). A fresh build
// and an Update read profile, then Hangar Log, and nothing of a later section before Hangar Log completes. Then an
// Update meets a buy-back page RSI changed: the section is set aside and the build completes as a partial backup. The
// panel the user closed stays closed through the notice and the end; the notice holds one entry; nothing renders or
// announces a complete backup; the earlier complete snapshot stays in use; and once the user opens Build Status it
// shows COMPLETED WITH OMISSIONS.
export async function sectionOrderAndPartial() {
  await freshDashboard();
  const account = createSyntheticRsi({ handle: HANDLE, counts: { pledges: 8, buybacks: 6, orders: 3, storeCredit: 4, uec: 2, rec: 2, prospects: 3 } });
  setRsi(account);
  await selectCurrentRsiAccount(dashboard, HANDLE);
  await startBuild(dashboard);
  await waitForSavedDialog(dashboard, 120000);
  assertCanonicalOrder(sectionOrderOf(account.requests, HANDLE), "The fresh build");

  account.addPledges(2);
  const updateFrom = account.requests.length;
  await startBuild(dashboard);
  await waitForSavedDialog(dashboard, 120000);
  assertCanonicalOrder(sectionOrderOf(account.requests.slice(updateFrom), HANDLE), "The Update");
  const complete = (await storedSnapshots()).find((snapshot) => snapshot.handle === HANDLE);
  assertStep(complete?.status === "complete", `The Update did not leave a complete snapshot: ${JSON.stringify(complete)}`);

  // A melted pledge gives the next Update a new buy-back page to read, and RSI has changed every buy-back page.
  account.meltPledge(account.state.pledges[0].id);
  account.failNext((record) => BUYBACK_PAGE.test(record.path), { status: 200, html: "<main><h1>A new page</h1></main>", times: 1000 });
  await startBuild(dashboard);
  await click(dashboard, "closeOverlay");
  await dashboard.waitFor("document.getElementById('parserOverlay').hidden", 8000, "the panel to close");
  await dashboard.evaluate(WATCH_PANEL);
  await dashboard.waitFor("document.getElementById('messageDialog').open", 120000, "the partial backup to be saved");
  const dialog = await dashboard.evaluate("({ title: document.getElementById('dialogTitle').textContent, message: document.getElementById('dialogMessage').textContent })");
  assertStep(dialog.title === "Partial backup saved", `The build did not end as a partial backup: ${JSON.stringify(dialog)}`);
  await dashboard.evaluate("document.getElementById('messageDialog').close()");
  const document = JSON.parse((await partialFile()).text);
  const outcomes = document.sync.sectionOutcomes;
  assertStep(outcomes.buybackDetails?.status === "failed" && Object.entries(outcomes).every(([section, outcome]) => section === "buybackDetails" || outcome.status === "complete") && document.sync.runs.at(-1).status === "partial",
    `The partial backup does not set aside only the changed section: ${JSON.stringify({ outcomes: Object.fromEntries(Object.entries(outcomes).map(([section, outcome]) => [section, outcome.status])), run: document.sync.runs.at(-1).status })}`);
  const watched = await dashboard.evaluate("({ ...window.__partial, hidden: document.getElementById('parserOverlay').hidden, entries: document.querySelectorAll('#parserChangeNotice .parser-change-entry').length })");
  assertStep(watched.hidden && watched.shown.length === 0, `The closed panel opened during the partial build: ${JSON.stringify(watched.shown)}`);
  assertStep(watched.entries === 1, `The notice holds ${watched.entries} entries for one changed section.`);
  assertStep(!watched.summaries.includes("COMPLETED") && !watched.announced.some((text) => text.startsWith("Build status: COMPLETED.")),
    `The partial build rendered or announced a complete backup: ${JSON.stringify({ summaries: [...new Set(watched.summaries)], announced: watched.announced })}`);
  const after = (await storedSnapshots()).find((snapshot) => snapshot.handle === HANDLE);
  assertStep(after?.runId === complete.runId && after.status === "complete", `The partial build replaced the complete snapshot: ${JSON.stringify({ before: complete, after })}`);

  // Build opens the panel with its chooser; the next status render shows the partial end.
  await dashboard.evaluate("document.getElementById('buildButton').click()");
  await dashboard.waitFor("!document.getElementById('parserOverlay').hidden", 8000, "Build to open the panel");
  await dashboard.waitFor("document.getElementById('overlaySummary').textContent === 'COMPLETED WITH OMISSIONS'", 20000, "the panel to show the partial end");
  return { freshOrder: sectionOrderOf(account.requests.slice(0, updateFrom), HANDLE).order.length, notice: watched.entries, snapshot: after.runId === complete.runId };
}

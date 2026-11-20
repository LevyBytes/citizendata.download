import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dashboard, extensionPage, rsi } from "./browser-pages-and-account-in-use.mjs";
import { assertCompleteDocument } from "./complete-document-expectations.mjs";
import { startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { assertHarnessParity, longestGap } from "./harness-parity-and-request-measures.mjs";
import { out } from "./options-and-run-folders.mjs";
import { TOKEN, WATCHDOG } from "./origins-keys-and-stand-in-image.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { storedCollection } from "./service-worker-stop-storage-heap-and-errors.mjs";
import { alarms, waitForDownloads, waitForState } from "./stored-state-alarms-and-saved-files.mjs";

export async function fullBackup() {
  const before = rsi.requests.length;
  const started = Date.now();
  await startBuild(dashboard);
  await waitForState((state) => state.status === "running", 15000, "collection to start");
  // While the job runs there is exactly one alarm, the repeating watchdog.
  assert.deepEqual((await alarms()).map(({ name, period }) => ({ name, period })), [{ name: WATCHDOG, period: 0.5 }], "A running job must hold exactly the repeating watchdog alarm.");
  await waitForSavedDialog(dashboard, 300000);
  const elapsedSeconds = (Date.now() - started) / 1000;
  const requests = rsi.requests.slice(before);
  const [backup] = await waitForDownloads(1);
  assertCompleteDocument(JSON.parse(backup.text), rsi);
  await assertHarnessParity(JSON.parse(backup.text), {});
  // The session token goes to RSI on its POST routes only and appears nowhere in what the user receives or the extension keeps.
  assertStep(requests.filter((request) => request.method === "POST").every((request) => request.tokenSent) && requests.filter((request) => request.method === "GET").every((request) => !request.tokenSent), "The RSI token must accompany POST routes only.");
  assertStep(!backup.text.includes(TOKEN), "The saved backup contains the session token.");
  const kept = await extensionPage.evaluate("Promise.all([chrome.storage.local.get(null), chrome.storage.session.get(null)]).then((stores) => JSON.stringify(stores))");
  assertStep(!kept.includes(TOKEN), "Extension storage contains the session token.");
  const recovery = await extensionPage.evaluate("chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'EXPORT_BACKUP' }).then((response) => JSON.stringify(response))");
  assertStep(recovery.includes(rsi.state.handle) && !recovery.includes(TOKEN), "The extension's stored jobs and snapshots contain the session token.");
  // One step a second or better. Stepping by alarm, at one step per 30 seconds, would take many minutes.
  // Buy-back pages are read with GET. The one other address under /pledge is the price query of the store upgrade
  // page, for the CCU buy-backs: no store page, no cart.
  const pledgePaths = [...new Set(requests.map((request) => request.path).filter((requested) => requested.startsWith("/pledge") || requested.startsWith("/en/pledge")).map((requested) => requested.replace(/[0-9]+$/u, "#")))].sort();
  assert.deepEqual(pledgePaths, ["/en/pledge/buyback/#", "/pledge-store/api/upgrade/graphql", "/pledge/buyback/#"], "Only buy-back pages and the CCU buy-back price query may be asked for under /pledge.");
  assertStep(requests.filter((request) => request.path.includes("/pledge/buyback/")).every((request) => request.method === "GET" && !request.tokenSent), "A buy-back page must be read with GET and without the session token.");
  assertStep(longestGap(requests) < 5000 && elapsedSeconds < 200, `The backup took ${elapsedSeconds.toFixed(1)} s for ${requests.length} requests with a longest pause of ${longestGap(requests)} ms; the loop is not keeping its pacing.`);
  await waitForState((state) => state.status === "complete" && state.pendingResult === null, 8000, "the saved result to be acknowledged");
  assert.deepEqual(await alarms(), [], "No alarm may remain after the run.");
  // Once the dashboard has saved the file, the extension keeps the saved backup and nothing else of the run.
  const stored = await storedCollection();
  assert.deepEqual({ pages: stored.pages, stagedRuns: stored.stagedRuns, snapshots: stored.snapshots }, { pages: [], stagedRuns: [], snapshots: 1 }, "A saved run must leave no working copy behind.");
  assertStep(stored.largestJobCharacters < 20000, `A job record holds ${stored.largestJobCharacters} characters; collected rows belong in the page store.`);
  await writeFile(path.join(out, "dashboard-after-backup.png"), await dashboard.screenshot());
  return { seconds: Number(elapsedSeconds.toFixed(1)), requests: requests.length, longestPauseMs: longestGap(requests), bytes: backup.text.length };
}

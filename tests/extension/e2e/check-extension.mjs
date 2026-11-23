// End-to-end check of the real extension in an installed Chrome, against a synthetic RSI.
//
// The unpacked extension, its offscreen parser, and the real dashboard run as they are, but for one thing: they are
// copies that do not space their requests (see PACE_KEY and docsRoot). Every http and https request the
// browser makes is paused through the DevTools Fetch domain and answered on this machine: RSI from
// tests/support/synthetic-rsi.js, the hosted dashboard from docs/. Name resolution is switched off as well, so nothing
// can reach RSI or any other host. No debugger is attached to the service worker, so Chrome ends and restarts it exactly
// as it would for a user.
//
// Usage: node tests/extension/e2e/check-extension.mjs --out <evidence directory>
//          [--browser <Chrome executable>] [--headed] [--only <scenario,...>] [--large] [--open-file <account JSON> [--open-orgs <Orgs JSON>] [--open-zip <Images ZIP>]] [--import-recovery <recovery JSON>]
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { unexpectedRequests } from "./check-extension/answers-to-browser-requests.mjs";
import { chrome, extensionId } from "./check-extension/browser-pages-and-account-in-use.mjs";
import { launchChromeWithTheExtension } from "./check-extension/chrome-launch-with-the-extension.mjs";
import { executable, options, out, scratch } from "./check-extension/options-and-run-folders.mjs";
import { accountRemoval } from "./check-extension/scenario-account-removal.mjs";
import { buildHistoryKept } from "./check-extension/scenario-build-history-kept.mjs";
import { buildHistorySetting } from "./check-extension/scenario-build-history-setting.mjs";
import { fullBackup } from "./check-extension/scenario-full-backup.mjs";
import { hangarLinkExport } from "./check-extension/scenario-hangar-link-export.mjs";
import { hostedDashboard } from "./check-extension/scenario-hosted-dashboard.mjs";
import { keptImages } from "./check-extension/scenario-kept-images.mjs";
import { largeAccount } from "./check-extension/scenario-large-account.mjs";
import { ledgersRetryAfter } from "./check-extension/scenario-ledgers-retry-after.mjs";
import { localCopyApproval } from "./check-extension/scenario-local-copy-approval.mjs";
import { openedFileKept } from "./check-extension/scenario-opened-file-kept.mjs";
import { paceStateAfterUpdate } from "./check-extension/scenario-pace-state-after-update.mjs";
import { pauseCancelRaces } from "./check-extension/scenario-pause-cancel-races.mjs";
import { pauseResumeCancel } from "./check-extension/scenario-pause-resume-cancel.mjs";
import { popupClearAllData } from "./check-extension/scenario-popup-clear-all-data.mjs";
import { protocolMismatch } from "./check-extension/scenario-protocol-mismatch.mjs";
import { popupRecoveryImport } from "./check-extension/scenario-popup-recovery-import.mjs";
import { reloadAndReconnect } from "./check-extension/scenario-reload-and-reconnect.mjs";
import { revokeLocalApproval } from "./check-extension/scenario-revoke-local-approval.mjs";
import { results, scenario } from "./check-extension/scenario-runner.mjs";
import { sectionOrderAndPartial } from "./check-extension/scenario-section-order-and-partial.mjs";
import { skipCcuPrices } from "./check-extension/scenario-skip-ccu-prices.mjs";
import { throttledMalformedRows } from "./check-extension/scenario-throttled-malformed-rows.mjs";
import { updateBackup } from "./check-extension/scenario-update-backup.mjs";
import { watchdogRestartAndResultRecovery } from "./check-extension/scenario-watchdog-restart-and-result-recovery.mjs";
import { workerRestartPoints } from "./check-extension/scenario-worker-restart-points.mjs";
import { extensionErrors } from "./check-extension/service-worker-stop-storage-heap-and-errors.mjs";

let exitCode = 0;
try {
  await launchChromeWithTheExtension();
  await scenario("local-copy-approval", localCopyApproval);
  await scenario("full-backup", fullBackup);
  await scenario("hangar-link-export", hangarLinkExport);
  await scenario("build-history-setting", buildHistorySetting);
  await scenario("update-backup", updateBackup);
  await scenario("build-history-kept", buildHistoryKept);
  await scenario("kept-images", keptImages);
  await scenario("pause-resume-cancel", pauseResumeCancel);
  await scenario("skip-ccu-prices", skipCcuPrices);
  await scenario("ledgers-retry-after", ledgersRetryAfter);
  await scenario("worker-restart-points", workerRestartPoints);
  await scenario("pace-state-after-update", paceStateAfterUpdate);
  await scenario("pause-cancel-races", pauseCancelRaces);
  await scenario("section-order-and-partial", sectionOrderAndPartial);
  await scenario("throttled-malformed-rows", throttledMalformedRows);
  await scenario("protocol-mismatch", protocolMismatch);
  await scenario("reload-and-reconnect", reloadAndReconnect);
  await scenario("watchdog-restart-and-result-recovery", watchdogRestartAndResultRecovery);
  await scenario("hosted-dashboard", hostedDashboard);
  await scenario("revoke-local-approval", revokeLocalApproval);
  await scenario("popup-clear-all-data", popupClearAllData);
  await scenario("popup-recovery-import", popupRecoveryImport);
  await scenario("opened-file-kept", openedFileKept);
  await scenario("account-removal", accountRemoval);
  if (options.large) {
    await scenario("large-account", largeAccount);
  } else {
    results.push({ name: "large-account", status: "not run", reason: "pass --large" });
  }

  assert.deepEqual(await extensionErrors(), [], "Chrome recorded extension errors during the run.");
  assert.deepEqual(unexpectedRequests, [], "A request was made to a host that is neither RSI nor the dashboard.");
} catch (error) {
  exitCode = 1;
  console.error(error.stack ?? error);
} finally {
  await writeFile(path.join(out, "extension-e2e.json"), `${JSON.stringify({ browser: executable, extensionId, results, unexpectedRequests }, null, 2)}\n`);
  if (chrome) await chrome.close();
  await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
}
for (const result of results.filter((entry) => entry.status === "not run")) console.log(`NOT RUN ${result.name}${result.reason ? ` (${result.reason})` : ""}`);
process.exit(exitCode || process.exitCode || 0);

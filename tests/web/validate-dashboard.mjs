import { rm } from "node:fs/promises";
import { chrome, socket } from "./validate-dashboard/chrome-process-and-devtools-commands.mjs";
import { assertDownloadDirectory, ccuOnly, downloadDirectory, profileDirectory, repairsOnly, statusOnly, supportOnly } from "./validate-dashboard/run-options-and-work-folders.mjs";

try {
  // Each group of steps is a module that runs when it is imported, so the order of these lines is the order of the run.
  await import("./validate-dashboard/connection-and-example-load-steps.mjs");
  if (statusOnly) await import("./validate-dashboard/focused-status-run-steps.mjs");
  else if (repairsOnly) await import("./validate-dashboard/focused-repairs-run-steps.mjs");
  else if (supportOnly) await import("./validate-dashboard/focused-support-run-steps.mjs");
  else if (ccuOnly) await import("./validate-dashboard/focused-ccu-run-steps.mjs");
  else {
    await import("./validate-dashboard/full-run-example-page-wording-and-overview-steps.mjs");
    await import("./validate-dashboard/full-run-example-inventory-inspector-roster-and-hero-steps.mjs");
    await import("./validate-dashboard/full-run-build-chooser-support-ccu-exports-and-referral-lists-steps.mjs");
    await import("./validate-dashboard/full-run-organization-switch-buyback-filters-and-extension-notice-steps.mjs");
    await import("./validate-dashboard/full-run-collection-activity-and-request-progress-steps.mjs");
    await import("./validate-dashboard/full-run-continuable-partial-and-completed-status-steps.mjs");
    await import("./validate-dashboard/full-run-narrow-navigation-and-responsive-inventory-steps.mjs");
    await import("./validate-dashboard/full-run-organization-offline-and-long-text-geometry-steps.mjs");
    await import("./validate-dashboard/full-run-loaded-account-file-and-missing-metadata-steps.mjs");
    await import("./validate-dashboard/full-run-referral-unavailable-identity-steps.mjs");
    await import("./validate-dashboard/full-run-pagination-and-collection-scroll-reset-steps.mjs");
    await import("./validate-dashboard/full-run-rejected-account-files-steps.mjs");
    await import("./validate-dashboard/full-run-zero-balances-affiliate-only-and-redacted-fixtures-steps.mjs");
    await import("./validate-dashboard/full-run-remaining-checks-and-pass-report-steps.mjs");
    await import("./validate-dashboard/full-run-build-status-caution-and-renderer-steps.mjs");
  }
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill();
    await exited;
  }
  await rm(profileDirectory, { recursive: true, force: true });
  assertDownloadDirectory();
  await rm(downloadDirectory, {recursive:true,force:true});
}

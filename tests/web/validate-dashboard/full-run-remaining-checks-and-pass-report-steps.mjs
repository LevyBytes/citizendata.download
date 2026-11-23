import { writeFile } from "node:fs/promises";
import path from "node:path";
import { checkAccountSwitchWithExtension } from "./account-switch-with-extension-check.mjs";
import { checkAccountRemovalUnderSwitchAccount } from "./account-removal-under-switch-account-check.mjs";
import { checkAccountSwitchWithoutExtension } from "./account-switch-without-extension-check.mjs";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { checkAuditRepairs } from "./audit-repairs-check.mjs";
import { checkBuildHandOver } from "./build-hand-over-waiting-file-and-recovery-backup-check.mjs";
import { checkBuildStatusHeader, checkInventoryValueColumn } from "./build-status-header-and-inventory-value-column-checks.mjs";
import { checkBuybackDetails, checkCcuLeadImage } from "./ccu-lead-image-and-buyback-details-checks.mjs";
import { exceptions, remoteRequests } from "./chrome-process-and-devtools-commands.mjs";
import { checkExampleAccount } from "./example-account-check.mjs";
import { checkSemanticStructures } from "./semantic-structures-and-keyboard-scrolling-check.mjs";
import { checkLoadedExampleHasNoDummyHistory } from "./example-ccu-history-checks.mjs";
import { checkExtensionRequests } from "./extension-requests-check.mjs";
import { checkHangarLinkExport } from "./hangar-link-export-check.mjs";
import { checkHangarLinkImport } from "./hangar-link-import-check.mjs";
import { checkImageDownload } from "./image-download-cancelled-check.mjs";
import { checkImageDownloadCancelledInARefusalWait } from "./image-download-cancelled-in-a-refusal-wait-check.mjs";
import { checkImageRunFinalizingAndCompletionPoint } from "./image-run-finalizing-and-completion-point-check.mjs";
import { checkInventorySorting } from "./inventory-sorting-check.mjs";
import { checkLatestBuildOnLoad } from "./latest-build-on-load-check.mjs";
import { checkLoadedExports } from "./loaded-exports-check.mjs";
import { checkPageStructure } from "./page-structure-check.mjs";
import { checkBuildChooserWording, checkRecoveryBackupOpens } from "./recovery-backup-and-build-chooser-wording-checks.mjs";
import { checkRemovedRecords } from "./removed-records-check.mjs";
import { captureScreenshots, downloadDirectory, exportReceipts, repositoryRoot, testDirectory } from "./run-options-and-work-folders.mjs";
import { checkSubscriptionFixtures } from "./subscription-tier-and-fixtures-checks.mjs";
import { checkSwitchAccountBelowTheAvatar } from "./switch-account-below-the-avatar-check.mjs";

await checkLoadedExampleHasNoDummyHistory();
await checkSubscriptionFixtures();
await checkLoadedExports();
await checkHangarLinkExport();
await checkAuditRepairs();
await checkBuybackDetails();
await checkRemovedRecords();
await checkInventorySorting();
await checkExampleAccount();
await checkPageStructure();
await checkSemanticStructures();
await checkInventoryValueColumn();
await checkBuildStatusHeader();
await checkLatestBuildOnLoad();
await checkAccountSwitchWithoutExtension();
await checkAccountSwitchWithExtension();
await checkAccountRemovalUnderSwitchAccount();
await checkSwitchAccountBelowTheAvatar();
await checkBuildChooserWording();
await checkBuildHandOver();
await checkRecoveryBackupOpens();
await checkExtensionRequests();
await checkImageDownload();
await checkImageDownloadCancelledInARefusalWait();
await checkImageRunFinalizingAndCompletionPoint();
await checkCcuLeadImage();
await checkHangarLinkImport();
if (captureScreenshots) await writeFile(
  path.join(testDirectory, 'work-temp-export-results.json'),
  `${JSON.stringify({actualDownloads:exportReceipts.length,downloads:exportReceipts,downloadDirectory:path.relative(repositoryRoot,downloadDirectory),cleanup:'Temporary download folder removed after browser shutdown'}, null, 2)}\n`
);

assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join(" | ")}`);
assert(remoteRequests.length === 0, `Unexpected remote requests: ${remoteRequests.join(", ")}`);
console.log(`PASS export module placement, four modal viewport sizes, keyboard focus, native scope selection, Hangar Link files for the hangar, the buy-backs, and both, the reason the example account has none, custom controls, ${exportReceipts.length} `
  + `actual Blob JSON downloads, full records beyond filters/pagination, raw log four-field fidelity, exact billing amounts, and approved header wrapping`);
console.log('PASS subscription summary and detail placement at 15 widths; exact Imperator/Centurion colors; active, ended, missing, null, empty, unknown and malformed data; cumulative totals without duplicate payments; partial payment history; separate '
  + 'currencies; exact long amounts; and retained REC detail');
console.log('PASS single example CCU control, native labeled history dialog, complete upgrade/applied-date/cost/value rows, eight viewport sizes, Escape/close focus return, inspector entry, no nested buttons, final Melt Value/Buyback Price facts, zero '
  + 'versus missing money, multi-step zero-cost CCU, and no fabricated history/prices in loaded files');
console.log("PASS single badge/title, all four hero centers, both inventory datasets and whole dashboard at 15 widths, compact collection labels/values and row density with semantic headers, support links and support/offline layout, public example "
  + "roster names/counts/order and all local profile avatars, handle-derived moniker/username links, demo-only prospect referral links, invalid/missing/redacted handle suppression, referral/organization pagination and scroll reset, Show all items, "
  + "filter reset, rejected JSON preservation, null/missing/zero balances, affiliate-only identity, redacted stale-field suppression, collapsed disclosures, narrow/short dialogs and active status, bounded long text, local JSON and unavailable metadata, "
  + "activity-only animation, and zero remote requests");

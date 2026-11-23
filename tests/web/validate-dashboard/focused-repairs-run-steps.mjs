import { checkAccountRemovalUnderSwitchAccount } from "./account-removal-under-switch-account-check.mjs";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { checkAuditRepairs } from "./audit-repairs-check.mjs";
import { checkBuildHandOver } from "./build-hand-over-waiting-file-and-recovery-backup-check.mjs";
import { checkBuildStatusHeader, checkInventoryValueColumn } from "./build-status-header-and-inventory-value-column-checks.mjs";
import { checkBuybackDetails, checkCcuLeadImage } from "./ccu-lead-image-and-buyback-details-checks.mjs";
import { exceptions, remoteRequests } from "./chrome-process-and-devtools-commands.mjs";
import { checkExampleAccount } from "./example-account-check.mjs";
import { checkExtensionNotice } from "./extension-notice-check.mjs";
import { checkExtensionRequests } from "./extension-requests-check.mjs";
import { checkHangarLinkImport } from "./hangar-link-import-check.mjs";
import { checkImageDownload } from "./image-download-cancelled-check.mjs";
import { checkImageDownloadCancelledInARefusalWait } from "./image-download-cancelled-in-a-refusal-wait-check.mjs";
import { checkImageRunFinalizingAndCompletionPoint } from "./image-run-finalizing-and-completion-point-check.mjs";
import { checkInventorySorting } from "./inventory-sorting-check.mjs";
import { checkLatestBuildOnLoad } from "./latest-build-on-load-check.mjs";
import { checkPageStructure } from "./page-structure-check.mjs";
import { checkBuildChooserWording, checkRecoveryBackupOpens } from "./recovery-backup-and-build-chooser-wording-checks.mjs";
import { checkRemovedRecords } from "./removed-records-check.mjs";
import { checkSwitchAccountBelowTheAvatar } from "./switch-account-below-the-avatar-check.mjs";

// The focused run for --repairs-only.
await checkExtensionNotice();
await checkAuditRepairs();
await checkBuybackDetails();
await checkRemovedRecords();
await checkInventorySorting();
await checkExampleAccount();
await checkPageStructure();
await checkInventoryValueColumn();
await checkBuildStatusHeader();
await checkLatestBuildOnLoad();
await checkBuildChooserWording();
await checkBuildHandOver();
await checkRecoveryBackupOpens();
await checkExtensionRequests();
await checkImageDownload();
await checkImageDownloadCancelledInARefusalWait();
await checkImageRunFinalizingAndCompletionPoint();
await checkCcuLeadImage();
await checkHangarLinkImport();
await checkSwitchAccountBelowTheAvatar();
await checkAccountRemovalUnderSwitchAccount();
assert(exceptions.length===0,`Browser exceptions: ${exceptions.join(' | ')}`);
assert(remoteRequests.length===0,`Unexpected remote requests: ${remoteRequests.join(', ')}`);
console.log('PASS focused repairs: install and update notices in the Build chooser, local-copy approval notice, protocol mismatch, deferred badge artwork, inspector status line, 100-record inventory paging with whole-dataset search and filters, '
  + 'recovery of a completed result, the captured price, discount, contents, and own-page link of a buy-back, removed pledges and buy-backs shown first in a red row at 4.5:1 labelled POTENTIAL GHOST REMOVAL with their facts, the example account read '
  + 'as a complete build with its two badges, its Eclipse buy-back, and its image figures, no empty band under the footer while Build Status is hidden, a Hangar Link file opened as an incomplete build with its hangar and buy-backs and no removal '
  + 'flagged, the controls of the page, its section order, script order, and policy links, the Melt Value and Price columns of the two inventory lists, the Build Status header with the artwork, scanning line, and embers of the approval card, the '
  + 'latest build opened on load when the extension hands one over and the example kept when it does not, the Build chooser line naming only what can be chosen, an opened account file and an opened Orgs JSON handed to the extension by themselves, an '
  + 'extension recovery backup opened as the newest build inside it, one bare request for each run control, a tampered result refused, organization rosters asked for by identifier, and an image download that is credential free, at most four at a time,'
  + ' cancellable, and saved as one ZIP; zero remote requests');
console.log('NOT RUN in --repairs-only mode: unrelated responsive, export, subscription, CCU and support suites.');

import { checkBuildStatusCautionAndRenderer } from "./build-status-caution-and-renderer-check.mjs";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { exceptions, remoteRequests } from "./chrome-process-and-devtools-commands.mjs";
import { checkStatusPanelLifecycle } from "./status-panel-lifecycle-check.mjs";
import { checkParserChangeNotice } from "./parser-change-notice-check.mjs";
import { checkBuildStatusFocusedSteps } from "./build-status-focused-steps-check.mjs";
import { checkBuildStatusFocusReturnsToOpener } from "./build-status-focus-returns-to-opener-check.mjs";

// The focused run for --status-only.
await checkStatusPanelLifecycle();
await checkBuildStatusCautionAndRenderer();
await checkParserChangeNotice();
await checkBuildStatusFocusedSteps();
await checkBuildStatusFocusReturnsToOpener();
assert(exceptions.length===0,`Browser exceptions: ${exceptions.join(' | ')}`);
assert(remoteRequests.length===0,`Unexpected remote requests: ${remoteRequests.join(', ')}`);
console.log('PASS focused extension status: stable active GIF source, independent close control, dismissed terminal state survives polling, Build chooser reopens account status, zero remote requests');
console.log('NOT RUN in --status-only mode: unrelated responsive, export, subscription, CCU and support suites.');

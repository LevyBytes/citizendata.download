import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { exceptions, remoteRequests } from "./chrome-process-and-devtools-commands.mjs";
import { checkSupportPanelLayout } from "./organization-selection-offline-placement-and-support-layout.mjs";

// The focused run for --support-only.
await checkSupportPanelLayout();
assert(exceptions.length===0,`Browser exceptions: ${exceptions.join(' | ')}`);
assert(remoteRequests.length===0,`Unexpected remote requests: ${remoteRequests.join(', ')}`);
console.log('PASS focused support/cards: two equal export actions with narrow stacking; support/export bounds; mobile stacking; opened-content growth; doubled fonts and longer text without clipping; zero '
  + 'remote requests');
console.log('NOT RUN in --support-only mode: unrelated account,subscription,CCU and export suites.');

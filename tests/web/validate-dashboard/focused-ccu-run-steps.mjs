import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { exceptions, remoteRequests } from "./chrome-process-and-devtools-commands.mjs";
import { checkExampleCcuHistory, checkLoadedExampleHasNoDummyHistory } from "./example-ccu-history-checks.mjs";

// The focused run for --ccu-only.
await checkExampleCcuHistory();
await checkLoadedExampleHasNoDummyHistory();
assert(exceptions.length===0,`Browser exceptions: ${exceptions.join(' | ')}`);
assert(remoteRequests.length===0,`Unexpected remote requests: ${remoteRequests.join(', ')}`);
console.log('PASS focused CCU history: Applied date/value and column order; desktop,760/761,440/441,390,320 and short640 layouts; no overlapping columns; null/missing/empty/non-string date fallbacks; trimmed raw date; keyboard focus; zero-cost steps; '
  + 'inspector prices; loaded-file isolation; zero remote requests');
console.log('NOT RUN in --ccu-only mode: unrelated full dashboard, subscription and export suites.');

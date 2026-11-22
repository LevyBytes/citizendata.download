import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { checkBuildStatusCautionAndRenderer } from "./build-status-caution-and-renderer-check.mjs";
import { checkBuildStatusFocusedSteps } from "./build-status-focused-steps-check.mjs";
import { checkBuildStatusFocusReturnsToOpener } from "./build-status-focus-returns-to-opener-check.mjs";
import { exceptions, remoteRequests } from "./chrome-process-and-devtools-commands.mjs";
import { checkParserChangeNotice } from "./parser-change-notice-check.mjs";

// Build Status while RSI refuses (PARSER_HARDENING.md §11): last, because it connects its own synthetic bridge.
await checkBuildStatusCautionAndRenderer();
// The notice that RSI changed a page (§11.4), through the same synthetic bridge.
await checkParserChangeNotice();
// The focused steps of §15.2 the two checks above leave open, through the same synthetic bridge.
await checkBuildStatusFocusedSteps();
// Close returns focus to the control that opened the panel (final criterion 31).
await checkBuildStatusFocusReturnsToOpener();
assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join(" | ")}`);
assert(remoteRequests.length === 0, `Unexpected remote requests: ${remoteRequests.join(", ")}`);
console.log("PASS Build Status presentation matrix and caution tape precedence, exact texts, B2 tape markup and direction, reduced motion, forced colours, 13 px warning prose, no status-driven reopen, Close focus return, stable nodes, keyed append-only " +
  "log with kept scroll, countdown-only ticks, stale revisions ignored, one announcement per state, focusable unavailable starts with W-25, W-20, 200 % zoom and job-kind isolation; the RSI page-change notice: exact prose, separate technical line, two " +
  "links of section id, code and HTTP status only, 13 px prose, no sideways overflow, one stable append per entry, no open, expand or focus change, W-27 with the notice, emptied at the next run; an older status degrades, identical statuses write " +
  "nothing, push and poll end on the greatest revision, Close holds through a partial, unavailable Continue and roster Start, dialog focus return, landmark and live regions, keyboard operation, four viewports, the image job's own controls and texts " +
  "that name no rate");

import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { chrome, pause, socket, stderr } from "./check-readability/chrome-process-and-devtools-commands.mjs";
import { coverageFailures, exceptions, notRun, palette, remoteRequests, spacing, states } from "./check-readability/evidence-lists-and-palette.mjs";
import { out, scratch, source } from "./check-readability/options-and-evidence-folders.mjs";

let runtimeError = null;
try {
  await import('./check-readability/connection-steps.mjs');
  await import('./check-readability/viewport-and-state-sampling-steps.mjs');
} catch (error) { runtimeError = String(error.stack || error); console.error(`Readability failed: ${error.message}`); if (stderr) console.error(stderr); }
finally {
  if (socket) socket.close();
  if (chrome.exitCode === null) chrome.kill();
  for (let attempt = 0; attempt < 100 && chrome.exitCode === null; attempt++) await pause(50);
  // The scratch folder is removed only when it is inside --out; when it is not, the run fails just below.
  if (path.dirname(path.resolve(scratch)) === out) await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
if (path.dirname(path.resolve(scratch)) !== out) throw new Error('Cleanup path escaped output');
const counts = { seen: 0, passed: 0, failed: 0, manual: 0, skipped: 0, notRun: notRun.length };
for (const state of states) { counts.seen += state.seen; for (const key of ['passed', 'failed', 'manual']) counts[key] += state.counts[key]; counts.skipped += Object.values(state.skipped).reduce((sum, value) => sum + value, 0); }
const failures = states.flatMap(state => state.results.filter(item => item.status === 'failed').map(item => ({ state: state.name, viewport: state.viewport.width, ...item })));
const report = {
  source, checkedAt: new Date().toISOString(), scope: 'Visible text samples and separately labeled solid palette contracts; not a WCAG certification', counts, states,
  palette, spacing, coverageFailures, notRun, failures, exceptions, blockedRemoteRequests: remoteRequests, runtimeError
};
await writeFile(path.join(out, 'readability.json'), `${JSON.stringify(report, null, 2)}\n`);
const paletteCounts = Object.fromEntries(['passed', 'failed', 'manual'].map(status => [status, palette.filter(item => item.status === status).length]));
const summary = [
  `# Readability evidence`, '', `${report.scope}.`, '',
  `Rendered samples: **${counts.passed} passed, ${counts.failed} failed, ${counts.manual} manual** (${counts.seen} seen). Skipped hidden/offscreen/inactive/covered samples: ${counts.skipped}. State captures not run: ${counts.notRun}.`,
  '',
  `Separate solid-only palette contracts: ${paletteCounts.passed} passed, ${paletteCounts.failed} failed, ${paletteCounts.manual} manual. These do not establish contrast over gradients, images, canvas, pseudo-elements, filters, or opacity.`,
  '', '## Coverage', '', '| State | Width | Seen | Passed | Failed | Manual |', '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...states.map(state => `| ${state.name} | ${state.viewport.width} | ${state.seen} | ${state.counts.passed} | ${state.counts.failed} | ${state.counts.manual} |`), '',
  '## Measured failures', '',
  ...(failures.length ? failures.slice(0, 40).map(item => `- ${item.state}, ${item.viewport}px: ${item.selector} (${item.text}) ${item.ratio.toFixed(2)}:1; requires ${item.required}:1.`) : ['None in measurable solid-background samples.']),
  '', '## Manual and not-run limits', '',
  '- Complex-background samples retain their source colors and explicit manual-review reasons in readability.json. Solid-only estimated ratios for these samples are not passes.',
  '- Only text visible in the configured viewport/state samples is covered; repeated samples are counted repeatedly. Offscreen, collapsed, disabled, inert, and modal-covered text is excluded.',
  '- Placeholders are included when empty and visible. Input values, password fields, native popup menus, and cross-origin/closed-shadow-root contents are not inspected.',
  '- Anti-aliased screenshot pixels, arbitrary composited backgrounds, icon contrast, focus contrast, color vision, full keyboard behavior, and complete WCAG conformance are not established.',
  '- No scrollbar hiding or persistent page/source changes were used. Local UI state changed only through the supplied interaction plan.',
  `- Runtime exceptions: ${exceptions.length}; blocked remote page attempts: ${remoteRequests.length}; runtime error: ${runtimeError ? 'yes' : 'none'}.`,
  ...notRun.map(item => `- Not run: ${item.state} ${item.viewport.width}px: ${item.reason}.`), '',
  'See readability.json for complete computed colors, background layers, thresholds, exclusions, and explicit palette checks.', ''
];
const limitsIndex = summary.indexOf('## Manual and not-run limits');
summary.splice(limitsIndex, 0, '## Coverage and text spacing', '', ...coverageFailures.map(item => `- Coverage failure: ${item.state} ${item.viewport.width}px: ${item.reason}.`), ...(coverageFailures.length ? [] : ['Every configured state met its minimum '
  + 'seen-text requirement.']), '', ...spacing.map(item => `- ${item.name} ${item.width}px: ${item.status}; ${item.failures.length ? item.failures.join('; ') : 'no new page/dialog overflow or visible clipping detected'}.`), '', 'Text-spacing fixtures '
  + 'temporarily use line-height 1.5, paragraph following-space 2em, letter-spacing .12em, and word-spacing .16em. Existing truncation, all text collisions, and full-page reflow are not established by these bounded geometry comparisons.', '');
await writeFile(path.join(out, 'REPORT.md'), summary.join('\n'));
process.exitCode = counts.failed || paletteCounts.failed || runtimeError || exceptions.length || remoteRequests.length || notRun.length || coverageFailures.length || spacing.some(item => item.status === 'failed') ? 1 : 0;
console.log(`TOTAL ${counts.passed} passed; ${counts.failed} failed; ${counts.manual} manual; ${counts.skipped} skipped; ${counts.notRun} not run. Output: ${out}`);

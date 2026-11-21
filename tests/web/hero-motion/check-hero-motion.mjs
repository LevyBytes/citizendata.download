import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { chrome, pause, rejectPending, socket, spawnError } from "./check-hero-motion/chrome-process-and-devtools-commands.mjs";
import { browserFolder, scratch } from "./check-hero-motion/options-and-evidence-folders.mjs";
import { evidence, exceptions, geometry, remote, screenshot } from "./check-hero-motion/page-evaluation-evidence-and-screenshots.mjs";

// A cleanup problem is thrown after `finally`, so it never takes the place of the error a failed check rethrows.
let cleanupError = null;
let checkFailed = false;
try {
  await import('./check-hero-motion/connection-and-page-load-steps.mjs');
  await import('./check-hero-motion/rotation-pulse-and-ember-timing-steps.mjs');
  await import('./check-hero-motion/artworks-and-always-on-motion-steps.mjs');
  await import('./check-hero-motion/paused-motion-single-loop-and-uncovered-controls-steps.mjs');
  await import('./check-hero-motion/layout-at-widths-and-results-steps.mjs');
} catch (error) {
  checkFailed = true;
  if (socket?.readyState === 1) { try { await screenshot('failure.png'); } catch { /* The screenshot is best effort; failure.txt and the error rethrown below are what the run reports. */ } }
  await writeFile(path.join(browserFolder, 'failure.txt'), `${String(error.stack || error)}\n`);
  await writeFile(path.join(browserFolder, 'partial-results.json'), `${JSON.stringify({ ...evidence, geometry, exceptions, remote }, null, 2)}\n`);
  throw error;
} finally {
  rejectPending(new Error('Browser check is closing'));
  if (socket) socket.close();
  if (!spawnError && chrome.exitCode === null && chrome.signalCode === null) chrome.kill();
  for (let attempt = 0; attempt < 100 && !spawnError && chrome.exitCode === null && chrome.signalCode === null; attempt++) await pause(50);
  if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) cleanupError = new Error('Chrome did not terminate within 5s; the owned profile is retained for inspection');
  else if (path.dirname(path.resolve(scratch)) !== browserFolder) cleanupError = new Error('Cleanup path escaped --out');
  else await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  // A failed check's own error is the one the run fails with; a cleanup problem beside it is still told.
  if (cleanupError && checkFailed) console.error(cleanupError.message);
}
// Reached only when the check passed: a failed check has rethrown its own error.
if (cleanupError) throw cleanupError;

import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { server } from "./check-firefox/docs-server-on-loopback.mjs";
import { capabilities, child, command, pause, socket } from "./check-firefox/firefox-process-and-bidi-commands.mjs";
import { out, scratch, source } from "./check-firefox/options-and-evidence-folders.mjs";
import { checks, logs, modes } from "./check-firefox/page-checks-and-screenshots.mjs";

let failure;
try {
  await import('./check-firefox/connection-and-tab-steps.mjs');
  await import('./check-firefox/dashboard-smoke-steps-from-file-and-loopback.mjs');
} catch (error) { failure = String(error.stack || error); console.error(error.message); }
finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await command('session.end'); } catch { /* Firefox may already be gone; the cleanup below goes on without the session's end. */ } }
  socket?.close();
  if (child.exitCode === null) child.kill();
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) await pause(50);
  await new Promise(resolve => server.close(resolve));
  // The scratch folder is removed only when it is inside --out; when it is not, the run fails just below.
  if (path.dirname(path.resolve(scratch)) === out) await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
if (path.dirname(path.resolve(scratch)) !== out) throw new Error('Scratch cleanup escaped output');
const errors = logs.filter(entry => entry.level === 'error');
const result = {
  browser: capabilities, source, checkedAt: new Date().toISOString(), checks, modes, errors, failure,
  scope: 'Bounded stock Firefox file and loopback smoke; not Safari acceptance, hosted HTTPS deployment, full accessibility, or extension collection testing'
};
await writeFile(path.join(out, 'firefox-compatibility.json'), `${JSON.stringify(result, null, 2)}\n`);
process.exitCode = failure || errors.length ? 1 : 0;
console.log(`${checks.length} checks; ${errors.length} browser errors; ${failure ? 'FAILED' : 'completed'}. Output: ${out}`);

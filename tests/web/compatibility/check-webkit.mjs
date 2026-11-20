import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { browser, checks, errors, failedChecks, modes, playwrightVersion, remoteAttempts, screenshotWarnings, server, version } from "./check-webkit/evidence-lists-and-browser-in-use.mjs";
import { originalTemp, out, scratch, source } from "./check-webkit/options-and-evidence-folder.mjs";

let failure;
try {
  await import('./check-webkit/playwright-module-fixture-file-and-docs-server-steps.mjs');
  await import('./check-webkit/webkit-page-with-error-and-request-watch-steps.mjs');
  await import('./check-webkit/dashboard-smoke-steps-from-file-and-loopback.mjs');
} catch (error) { failure = String(error.stack || error); console.error(error.message); }
finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  for (const [key, value] of Object.entries(originalTemp)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (path.dirname(path.resolve(scratch)) !== out) throw new Error('Scratch cleanup escaped output');
  await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
await writeFile(
  path.join(out, 'webkit-compatibility.json'),
  JSON.stringify({ engine: 'Playwright WebKit, not Safari', version, playwrightVersion, source, checkedAt: new Date().toISOString(), checks, failedChecks, modes, errors, remoteAttempts, screenshotWarnings, failure }, null, 2) + '\n'
);
process.exitCode = failure || failedChecks.length || errors.length || remoteAttempts.length ? 1 : 0;
console.log(`${checks.length} passed; ${failedChecks.length} failed; ${errors.length} browser errors; ${remoteAttempts.length} external requests; ${screenshotWarnings.length} screenshot warnings; ${failure ? 'interrupted' : 'completed'}. Output: ${out}`);

import assert from 'node:assert/strict';
import path from 'node:path';
import { browser, checks, errors, remoteAttempts, screenshotWarnings, setBrowser, setTakingScreenshot, setVersion, takingScreenshot } from "./evidence-lists-and-browser-in-use.mjs";
import { options, out, scratch } from "./options-and-evidence-folder.mjs";
import { hosted, webkit } from "./playwright-module-fixture-file-and-docs-server-steps.mjs";

setBrowser(await webkit.launch({ executablePath: path.resolve(options.browser), headless: true, downloadsPath: scratch, tracesDir: scratch, timeout: 15000, env: { ...process.env } }));
setVersion(browser.version());
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
export const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() !== 'error') return;
  // Playwright WebKit injects a temporary `body {}` style to synchronize animation before screenshots.
  // Keep this specific automation/CSP interaction visible without weakening the site's policy.
  if (takingScreenshot && message.text() === "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.") {
    screenshotWarnings.push({ url: page.url(), message: message.text() });
  } else errors.push(message.text());
});
await page.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/u.test(url) && !url.startsWith(hosted)) { remoteAttempts.push(url); return route.abort(); }
  return route.continue();
});
export const check = async (name, expression) => { assert.equal(await page.evaluate(expression), true, name); checks.push(name); };
export const screenshot = async (file) => {
  setTakingScreenshot(true);
  try { await page.screenshot({ path: path.join(out, file), caret: 'initial' }); }
  finally { setTakingScreenshot(false); }
};

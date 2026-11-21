import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checks, modes } from "./evidence-lists-and-browser-in-use.mjs";
import { out, source } from "./options-and-evidence-folder.mjs";
import { fixtureFile, hosted } from "./playwright-module-fixture-file-and-docs-server-steps.mjs";
import { check, page, screenshot } from "./webkit-page-with-error-and-request-watch-steps.mjs";

for (const [mode, url] of [['file', pathToFileURL(path.join(source, 'index.html')).href], ['loopback', hosted]]) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('accountHandle')?.textContent === 'DownloadCitizen');
  await page.evaluate(() => Promise.all([300, 500, 700].map(weight => document.fonts.load(`${weight} 16px Orbitron`))).then(() => document.fonts.ready));
  await check(`${mode}: three example hangar records`, "document.querySelectorAll('tr[data-record-key]').length === 3");
  await check(`${mode}: bundled fonts loaded`, "[...document.fonts].filter(font => font.family === 'Orbitron').every(font => font.status === 'loaded')");
  modes.push({ mode, support: await page.evaluate(() => ({
    container: CSS.supports('container-type', 'inline-size'), has: CSS.supports('selector(:has(*))'), dvh: CSS.supports('height', '100dvh'),
    backdrop: CSS.supports('backdrop-filter', 'blur(2px)'), mask: CSS.supports('mask-image', 'linear-gradient(black, transparent)'), secure: isSecureContext,
    uuid: typeof crypto.randomUUID, dialog: typeof HTMLDialogElement.prototype.showModal
  })) });
  await page.click('#buybacksTab');
  await check(`${mode}: buyback tab`, "document.getElementById('buybacksTab').getAttribute('aria-selected') === 'true' && document.querySelectorAll('tr[data-record-key]').length === 4");
  await page.click('#hangarTab');
  await page.fill('#recordSearch', 'The Lamp');
  await check(`${mode}: inventory search`, "document.querySelectorAll('tr[data-record-key]').length === 1 && document.querySelector('tr[data-record-key]').textContent.includes('The Lamp')");
  await page.fill('#recordSearch', '');
  await page.click('tr[data-record-key="demo-pledge-1"] .ccu-history-button');
  await check(`${mode}: CCU modal`, "document.getElementById('ccuDialog').matches(':modal')");
  await page.click('#ccuDialog .dialog-close');
  await page.waitForFunction(() => document.activeElement.classList.contains('ccu-history-button'));
  await check(`${mode}: CCU focus return`, "document.activeElement.classList.contains('ccu-history-button')");
  for (const width of [320, 380, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await check(`${mode}: ${width}px document fits`, 'document.documentElement.scrollWidth <= innerWidth + 1');
  }
  await page.locator('#overview').scrollIntoViewIfNeeded();
  await screenshot(`${mode}-overview.png`);
  await page.click('#exportButton');
  await check(`${mode}: export modal and focus`, "document.getElementById('exportDialog').matches(':modal') && document.activeElement.id === 'exportPreset'");
  const expected = await page.evaluate(() => globalThis.CitizenDataExports.createExport(globalThis.CITIZENDATA_DEMO_DATA, { preset: 'inventory', inventoryScope: 'both', format: 'native', example: true }).text);
  const saved = page.waitForEvent('download');
  await page.click('#exportDownload');
  const download = await saved;
  const downloadPath = path.join(out, `${mode}-export.json`);
  await download.saveAs(downloadPath);
  assert.deepEqual(JSON.parse(await readFile(downloadPath, 'utf8')), JSON.parse(expected), `${mode}: downloaded JSON matches selected data`);
  checks.push(`${mode}: downloaded JSON matches selected data`);
  await page.click('#exportClose');
  await page.waitForFunction(() => document.activeElement.id === 'exportButton');
  await check(`${mode}: export focus return`, "document.activeElement.id === 'exportButton'");
  await page.setInputFiles('input[type=file]', fixtureFile);
  await page.waitForFunction(() => document.getElementById('accountHandle').textContent === 'CompatibilityCitizen');
  await check(`${mode}: file picker reads synthetic account`, "document.getElementById('messageDialog').matches(':modal') && document.getElementById('dialogTitle').textContent === 'Account file verified'");
  await page.click('#messageDialog .dialog-close');
  for (const [legal, title] of [['terms-of-service.html', 'Terms of Service'], ['privacy-policy.html', 'Privacy Policy']]) {
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto(new URL(legal, url).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await check(`${mode}: ${legal} renders without scripts`, `document.querySelector('h1').textContent === ${JSON.stringify(title)} && document.scripts.length === 0`);
    await check(`${mode}: ${legal} fits 320px`, 'document.documentElement.scrollWidth <= innerWidth + 1');
    // WebKit, like Safari by default, leaves links out of Tab: Safari reaches them with Option+Tab or with "Press Tab to
    // highlight each item on a webpage", and Windows WebKit has no such key. So after a key press, as a keyboard user
    // makes, the header link is focused directly and must draw its focus ring. The Firefox check presses a real Tab.
    await page.keyboard.press('Tab');
    await check(`${mode}: ${legal} keyboard focus`, `(() => {
      const link = document.querySelector('.legal-header a');
      link.focus();
      const style = getComputedStyle(link);
      return document.activeElement === link && link.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    })()`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await screenshot(`${mode}-${legal.replace('.html', '')}.png`);
    await page.click('.legal-header a[href="index.html"]');
    await page.waitForFunction(() => document.getElementById('accountHandle')?.textContent === 'DownloadCitizen');
    checks.push(`${mode}: ${legal} dashboard backlink`);
  }
  console.log(`PASS ${mode}: ${checks.length} cumulative checks`);
}

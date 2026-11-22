import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hosted } from "./docs-server-on-loopback.mjs";
import { command, context, pause } from "./firefox-process-and-bidi-commands.mjs";
import { fixtureFile } from "./firefox-profile-and-account-fixture-file.mjs";
import { downloads, out, source } from "./options-and-evidence-folders.mjs";
import { check, checks, click, evaluate, modes, screenshot, waitFor } from "./page-checks-and-screenshots.mjs";

// The scripts a browser would run: no type, a JavaScript type, or a module. The policy pages' JSON-LD is data and never
// runs, so it does not count against "renders without scripts".
const RUNNABLE_SCRIPTS = "[...document.scripts].filter((script) => ['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(script.type.trim().toLowerCase())).length";

for (const [mode, url] of [['file', pathToFileURL(path.join(source, 'index.html')).href], ['loopback', hosted]]) {
  await command('browsingContext.setViewport', { context, viewport: { width: 1440, height: 1000 }, devicePixelRatio: 1 });
  await command('browsingContext.navigate', { context, url, wait: 'complete' });
  await waitFor("document.getElementById('accountHandle')?.textContent === 'DownloadCitizen'");
  await evaluate('Promise.all([300, 500, 700].map(weight => document.fonts.load(weight + " 16px Orbitron"))).then(() => document.fonts.ready).then(() => true)');
  await check(`${mode}: three example hangar records`, "document.querySelectorAll('tr[data-record-key]').length === 3");
  await check(`${mode}: bundled fonts loaded`, "[...document.fonts].filter(font => font.family === 'Orbitron').every(font => font.status === 'loaded')");
  const support = await evaluate("({container: CSS.supports('container-type', 'inline-size'), has: CSS.supports('selector(:has(*))'), dvh: CSS.supports('height', '100dvh'), backdrop: CSS.supports('backdrop-filter', 'blur(2px)'), mask: "
    + "CSS.supports('mask-image', 'linear-gradient(black, transparent)'), secure: isSecureContext, uuid: typeof crypto.randomUUID, dialog: typeof HTMLDialogElement.prototype.showModal})");
  modes.push({ mode, support });
  await click('#buybacksTab');
  await check(`${mode}: buyback tab`, "document.getElementById('buybacksTab').getAttribute('aria-selected') === 'true' && document.querySelectorAll('tr[data-record-key]').length === 4");
  await click('#hangarTab');
  await evaluate("(() => { const input = document.getElementById('recordSearch'); input.value = 'The Lamp'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await check(`${mode}: inventory search`, "document.querySelectorAll('tr[data-record-key]').length === 1 && document.querySelector('tr[data-record-key]').textContent.includes('The Lamp')");
  await evaluate("(() => { const input = document.getElementById('recordSearch'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await click('tr[data-record-key="demo-pledge-1"] .ccu-history-button');
  await check(`${mode}: CCU modal`, "document.getElementById('ccuDialog').matches(':modal')");
  await click('#ccuDialog .dialog-close');
  await check(`${mode}: CCU focus return`, "document.activeElement.classList.contains('ccu-history-button')");
  for (const width of [320, 380, 768, 1440]) {
    await command('browsingContext.setViewport', { context, viewport: { width, height: 1000 }, devicePixelRatio: 1 });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    await check(`${mode}: ${width}px document fits`, 'document.documentElement.scrollWidth <= innerWidth + 1');
  }
  await evaluate("(() => { document.getElementById('overview').scrollIntoView({ block: 'start' }); return true; })()");
  await screenshot(`${mode}-overview`);
  await click('#exportButton');
  await check(`${mode}: export modal and focus`, "document.getElementById('exportDialog').matches(':modal') && document.activeElement.id === 'exportPreset'");
  const before = new Set(await readdir(downloads));
  const expected = await evaluate("globalThis.CitizenDataExports.createExport(globalThis.CITIZENDATA_DEMO_DATA, { preset: 'inventory', inventoryScope: 'both', format: 'native', example: true }).text");
  await click('#exportDownload');
  let downloadFile;
  for (let attempt = 0; attempt < 100; attempt++) {
    downloadFile = (await readdir(downloads)).find(name => !before.has(name) && name.endsWith('.json'));
    if (downloadFile) break;
    await pause(100);
  }
  assert.ok(downloadFile, `${mode}: JSON download created`);
  assert.deepEqual(JSON.parse(await readFile(path.join(downloads, downloadFile), 'utf8')), JSON.parse(expected), `${mode}: downloaded JSON matches selected data`);
  checks.push(`${mode}: downloaded JSON matches selected data`);
  await writeFile(path.join(out, `${mode}-export.json`), await readFile(path.join(downloads, downloadFile)));
  await click('#exportClose');
  await check(`${mode}: export focus return`, "document.activeElement.id === 'exportButton'");
  const input = await command('script.evaluate', { expression: 'document.querySelector("input[type=file]")', target: { context }, awaitPromise: false });
  await command('input.setFiles', { context, element: { sharedId: input.result.sharedId }, files: [fixtureFile] });
  await waitFor("document.getElementById('accountHandle').textContent === 'CompatibilityCitizen'");
  await check(`${mode}: file picker reads synthetic account`, "document.getElementById('messageDialog').matches(':modal') && document.getElementById('dialogTitle').textContent === 'Account file verified'");
  await click('#messageDialog .dialog-close');
  const broken = await evaluate("[...document.images].filter(image => !image.hidden && getComputedStyle(image).display !== 'none' && image.hasAttribute('src') && !image.complete).length");
  modes.at(-1).incompleteImages = broken;
  for (const [page, title] of [['terms-of-service.html', 'Terms of Service'], ['privacy-policy.html', 'Privacy Policy']]) {
    await command('browsingContext.setViewport', { context, viewport: { width: 320, height: 1000 }, devicePixelRatio: 1 });
    await command('browsingContext.navigate', { context, url: new URL(page, url).href, wait: 'complete' });
    await evaluate('document.fonts.ready.then(() => true)');
    await check(`${mode}: ${page} renders without scripts`, `document.querySelector('h1').textContent === ${JSON.stringify(title)} && ${RUNNABLE_SCRIPTS} === 0`);
    await check(`${mode}: ${page} fits 320px`, 'document.documentElement.scrollWidth <= innerWidth + 1');
    await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE004' }, { type: 'keyUp', value: '\uE004' }] }] });
    await check(`${mode}: ${page} keyboard focus`, "document.activeElement.matches('.legal-header a') && document.activeElement.matches(':focus-visible')");
    await screenshot(`${mode}-${page.replace('.html', '')}`);
    await click('.legal-header a[href="index.html"]');
    await waitFor("document.getElementById('accountHandle')?.textContent === 'DownloadCitizen'");
    checks.push(`${mode}: ${page} dashboard backlink`);
  }
  console.log(`PASS ${mode}: ${checks.length} cumulative checks`);
}

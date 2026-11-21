import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BrowserSession } from './browser-session.mjs';
import { buildLargeFixture, importLarge, motionSample } from "./run-performance/motion-sample-and-large-fixture.mjs";
import { assert, executable, log, out, outputLines, report, runs } from "./run-performance/options-report-and-asset-inventory.mjs";
import { action, load, observerSource, snapshot } from "./run-performance/page-observer-load-and-action-measures.mjs";
import { checkSupportingPages } from "./run-performance/supporting-pages-check.mjs";

let active;
try {
  for (let index = 1; index <= runs; index++) {
    active = await BrowserSession.open(executable, out);
    report.browser ??= await active.command('Browser.getVersion');
    await active.command('Page.addScriptToEvaluateOnNewDocument', { source: observerSource });
    await load(active, 'fresh-profile', index);
    if (index < runs) { report.exceptions.push(...active.exceptions); report.remoteRequests.push(...active.remote); await active.close(); active = null; }
  }
  for (let index = 1; index <= runs; index++) await load(active, 'warm-reload', index);
  for (let index = 0; index < runs; index++) {
    await action(active, 'example-search', "document.querySelector('#recordSearch').value='Package';document.querySelector('#recordSearch').dispatchEvent(new Event('input',{bubbles:true}));");
    await action(active, 'example-clear-search', "document.querySelector('#recordSearch').value='';document.querySelector('#recordSearch').dispatchEvent(new Event('input',{bubbles:true}));");
    const buybacks = await action(active, 'example-buybacks', "document.querySelector('#buybacksTab').click();"); assert(buybacks.renderedInventoryRows === 4, 'Example Buybacks rows changed');
    await action(active, 'example-hangar', "document.querySelector('#hangarTab').click();");
  }
  await motionSample(active, 'example-visible', '#overview'); await motionSample(active, 'example-offscreen', 'footer');
  report.syntheticFixture = await buildLargeFixture(active);
  assert(report.syntheticFixture.bytes < 25 * 1024 * 1024, 'Synthetic fixture exceeded the application file limit');
  for (let index = 1; index <= runs; index++) await importLarge(active, index);
  for (let index = 0; index < runs; index++) {
    const search = await action(
      active, 'large-search-one',
      "document.querySelector('#recordSearch').value='Performance Pledge 0007';document.querySelector('#recordSearch').dispatchEvent(new Event('input',{bubbles:true}));"
    ); assert(search.renderedInventoryRows === 1, 'Large search did not find its unique record');
    await action(active, 'large-clear-search', "document.querySelector('#recordSearch').value='';document.querySelector('#recordSearch').dispatchEvent(new Event('input',{bubbles:true}));");
    // The Buybacks table shows its records 100 to a page: all 1500 are listed when its first page holds 100 rows and its
    // page status counts 1,500 records over 15 pages.
    const buybacks = await action(active, 'large-buybacks', "document.querySelector('#buybacksTab').click();");
    const buybacksListed = await active.evaluate("document.querySelector('#inventoryPageStatus').textContent");
    assert(buybacks.renderedInventoryRows === 100 && buybacksListed === '1,500 records · page 1 of 15', `Large Buybacks did not list its 1500 records: ${buybacks.renderedInventoryRows} rows, "${buybacksListed}"`);
    await action(active, 'large-hangar', "document.querySelector('#hangarTab').click();");
    await action(active, 'large-referral-sort', "document.querySelector('#referralSortButton').click();");
    await action(active, 'large-organization-switch', "document.querySelector('[data-organization-sid=\"MMHC\"]').click();document.querySelector('[data-organization-sid=\"TEST\"]').click();");
  }
  await motionSample(active, 'large-visible', '#overview'); await motionSample(active, 'large-offscreen', 'footer');
  report.finalMetrics = await active.metrics();
  report.final = await snapshot(active);
  await checkSupportingPages(active);
  report.exceptions.push(...active.exceptions); report.remoteRequests.push(...active.remote);
  assert(!report.exceptions.length && !report.remoteRequests.length, 'Page exception or blocked remote request occurred');
} catch (error) { report.failures.push(String(error.stack || error)); outputLines.push(`FAILED: ${error.message}`); console.error(error.message); }
finally { if (active) { try { await active.close(); } catch (error) { report.failures.push(String(error.stack || error)); } } }
function distribution(values) { const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b); if (!sorted.length) return null; return { n:sorted.length,min:sorted[0],median:sorted[Math.floor(sorted.length/2)],max:sorted.at(-1) }; }
report.summary = { loads: Object.fromEntries(['fresh-profile',
  'warm-reload'].map(kind => [kind,
  {readyAfterFontsMs:distribution(report.loads.filter(row=>row.kind===kind).map(row=>row.readyAfterFontsMs)),loadEventEndMs:distribution(report.loads.filter(row=>row.kind===kind).map(row=>row.navigation?.loadEventEnd)),
  longTaskCount:distribution(report.loads.filter(row=>row.kind===kind).map(row=>row.longTasks.length))}])),
  interactions: Object.fromEntries([...new Set(report.interactions.map(row=>row.label))].map(label => [label,
  {durationMs:distribution(report.interactions.filter(row=>row.label===label).map(row=>row.durationMs??row.nextFrameMs)),handlerMs:distribution(report.interactions.filter(row=>row.label===label).map(row=>row.handlerMs))}])) };
report.finishedAt = new Date().toISOString();
await writeFile(path.join(out,'performance.json'),`${JSON.stringify(report,null,2)}\n`);
await writeFile(path.join(out,'assets.json'),`${JSON.stringify({scope:'uncompressed local docs tree bytes; not transferred/compressed payload',bytes:report.assetBytes,files:report.assets},null,2)}\n`);
const lines = ['# Local browser performance sample','',`Browser: ${report.browser?.product || 'unavailable'}; ${report.browser?.userAgent || ''}`,'',...report.limitations.map(text=>`- ${text}`),'','## Repeated loads','','| Mode | Samples | Ready after '
  + 'fonts median/max (ms) | Load end median/max (ms) |','| --- | ---: | ---: | ---: |',...Object.entries(report.summary.loads).map(([name,value])=>`| ${name} | ${value.readyAfterFontsMs?.n??0} | ${value.readyAfterFontsMs?.median.toFixed(1)??'—'} `
  + `/ ${value.readyAfterFontsMs?.max.toFixed(1)??'—'} | ${value.loadEventEndMs?.median.toFixed(1)??'—'} / ${value.loadEventEndMs?.max.toFixed(1)??'—'} |`),'','## Local interactions','','| Action | Samples | Next-frame/import median/max (ms) | Handler '
  + 'median/max (ms) |','| --- | ---: | ---: | ---: |',...Object.entries(report.summary.interactions).map(([name,value])=>`| ${name} | ${value.durationMs?.n??0} | ${value.durationMs?.median.toFixed(1)??'—'} / ${value.durationMs?.max.toFixed(1)??'—'} `
  + `| ${value.handlerMs?.median.toFixed(1)??'—'} / ${value.handlerMs?.max.toFixed(1)??'—'} |`),'','## Hero samples','','| State | Frames | Canvas paints | Renderer task % of wall |','| --- | ---: | ---: | ---: |',...report.motion.map(row=>`| ${row.label}`
  + ` | ${row.frames} | ${row.paints} | ${row.mainThreadTaskPercentOfWall.toFixed(2)} |`),'','## Assets and limits','',`The docs tree contains ${report.assets.length} files totaling ${report.assetBytes} uncompressed bytes. The first observed initial `
  + `resource set totals ${report.loads[0]?.initialResourceBytes??0} local source bytes. See assets.json for the inventory. No network transfer budget is implied.`,'',`Synthetic `
  + `fixture: ${report.syntheticFixture?JSON.stringify(report.syntheticFixture):'not reached'}.`,'',`Runtime exceptions: ${report.exceptions.length}; remote page attempts: ${report.remoteRequests.length}; behavior/runtime `
  + `failures: ${report.failures.length}.`,'',...report.failures.map(failure=>`\`\`\`text\n${failure}\n\`\`\``),'','Not run: hosted-site measurements, production Core Web Vitals, network throttling, '
  + 'Safari/Firefox behavior, Linux/VM browser runs, extension installation, authenticated account access, publication.',''];
await writeFile(path.join(out,'REPORT.md'),lines.join('\n'));
log(`Completed ${report.loads.length} loads and ${report.interactions.length} interaction samples; ${report.failures.length} failures. Evidence: ${out}`);
await writeFile(path.join(out,'run.log'),`${outputLines.join('\n')}\n`);
process.exitCode = report.failures.length ? 1 : 0;

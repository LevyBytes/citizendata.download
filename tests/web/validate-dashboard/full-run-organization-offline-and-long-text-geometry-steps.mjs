import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement, captureSupportRow, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkCompactCollections } from "./compact-collections-check-and-collection-scrolling.mjs";
import { checkDashboardGeometry } from "./dashboard-geometry-check.mjs";
import { checkFloatingGeometry } from "./geometry-probe-prelude-and-floating-geometry-check.mjs";
import { checkOfflinePlacement, selectOrganization } from "./organization-selection-offline-placement-and-support-layout.mjs";
import { checkResponsiveGeometry } from "./responsive-geometry-check.mjs";
import { captureScreenshots, testDirectory } from "./run-options-and-work-folders.mjs";

await selectOrganization('MMHC');
await evaluate("document.querySelector('#filterButton').click(); document.querySelector('.offline-detail').open=true");
for (const width of [1780, 1280, 1000, 900, 640, 480, 390, 320]) {
  await setViewport(width);
  await checkDashboardGeometry(`MMHC affiliate, filter controls, and offline section at ${width}px`);
  if ([1000, 640, 390].includes(width)) await checkCompactCollections(`MMHC compact roster at ${width}px`);
  if (captureScreenshots && [1280, 1000, 390].includes(width)) {
    await captureElement('#organizations', `work-temp-mmhc-${width}.png`, 1600);
    const clip = await evaluate("(()=>{const band=document.querySelector('.secondary-grid').getBoundingClientRect();const card=document.querySelector('.offline-detail').getBoundingClientRect();return {x:band.left+scrollX,y:card.top+scrollY,"
      + "width:band.width,height:card.height}})()");
    const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { ...clip, scale: 1 } });
    await writeFile(path.join(testDirectory, `work-temp-offline-row-${width}.png`), Buffer.from(capture.data, 'base64'));
  }
}
await evaluate("document.querySelector('#filterButton').click()");
await selectOrganization('TEST');

for (const width of [1000, 390, 320]) {
  await setViewport(width);
  for (const selector of ['#balances', '#referrals', '#organizations', '.offline-detail']) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).open=true; document.querySelector(${JSON.stringify(`${selector} > summary`)}).click()`);
    assert(
      await evaluate(`(() => { const panel=document.querySelector(${JSON.stringify(selector)}); return !panel.open && panel.getBoundingClientRect().height <= panel.querySelector('summary').getBoundingClientRect().height + 4; })()`),
      `Collapsed disclosure ${selector} leaves content or blank space at ${width}px.`
    );
    await checkDashboardGeometry(`collapsed ${selector} at ${width}px`);
    await evaluate(`document.querySelector(${JSON.stringify(`${selector} > summary`)}).click()`);
  }
}
await evaluate("document.querySelector('.offline-detail').open=false");
for (const width of [1780, 1280, 1000, 980, 640, 390]) {
  await checkOfflinePlacement(width);
  if (captureScreenshots && [1000, 640, 390].includes(width)) {
    await captureSupportRow(`work-temp-support-offline-${width}.png`);
    await captureElement('#organizations .collection-browser', `work-temp-compact-roster-${width}.png`, 1400);
    await captureElement('#referrals .collection-browser', `work-temp-compact-referrals-${width}.png`, 1400);
  }
}

for (const [width, height] of [[640, 320], [390, 400], [320, 480]]) {
  await setViewport(width, height);
  await evaluate("(()=>{window.__emitCitizenDataStatus(structuredClone(window.__citizendataActiveStatus));document.querySelector('#parserOverlay').classList.remove('minimized');return true})()");
  await waitFor("!document.querySelector('#parserOverlay').hidden && !document.querySelector('#collectionActivity').hidden");
  await checkFloatingGeometry('#parserOverlay', `expanded active status at ${width}x${height}`);
  if (captureScreenshots) await captureElement('#parserOverlay', `work-temp-active-status-${width}x${height}.png`);
  await evaluate("document.querySelector('#minimizeOverlay').click()");
  assert(await evaluate("document.querySelector('#parserOverlay').classList.contains('minimized')"), "Status minimize control did not collapse the overlay.");
  await checkFloatingGeometry('#parserOverlay', `minimized active status at ${width}x${height}`);
  await evaluate("document.querySelector('#parserOverlay').hidden=true");
}

await evaluate(`(() => {
  const edits = [
    ['#accountHandle', 'ExampleCitizenWithAnUnusuallyLongHandle'],
    ['#mainOrganization', 'International Exploration and Scientific Research Organization'],
    ['#displayTitle', 'Distinguished Exploration and Research Clearance Level Ultra'],
    ['#inventoryRows tr:first-child .record-button b', 'Package - Exploration Fleet Collection - Special Limited Anniversary Edition'],
    ['#inventoryRows tr:first-child .record-button small', 'Contains a long-named ship variant and a complete collection of additional equipment and hangar items'],
    ['#organizationRows tr:first-child .person-identity a', 'A Member With A Long Public Moniker And Several Additional Words'],
    ['#organizationRows tr:first-child td:nth-child(3) .collection-cell-value', 'Distinguished Exploration and Research Division Commander'],
    ['#organizationRows tr:first-child td:nth-child(4) .collection-cell-value', 'Recruitment, Expedition Planning, Scientific Research and Logistics Coordination'],
    ['#referralRows tr:first-child td:nth-child(3) .collection-cell-value', 'A long source date label retained exactly as it appeared in the saved document']
  ];
  window.__responsiveOriginalText = edits.map(([selector, value]) => {
    const node = document.querySelector(selector);
    const previous = node.textContent;
    node.textContent = value;
    return [selector, previous];
  });
})()`);
for (const width of [1600, 1280, 981, 390, 320]) {
  await setViewport(width);
  await checkResponsiveGeometry(`long content at ${width}px`);
  await checkDashboardGeometry(`long collection content at ${width}px`);
  await checkCompactCollections(`long collection metadata at ${width}px`, { density:false });
}
await evaluate("window.__responsiveOriginalText.forEach(([selector,value])=>{document.querySelector(selector).textContent=value})");

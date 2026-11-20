import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkCompactCollections } from "./compact-collections-check-and-collection-scrolling.mjs";
import { checkDashboardGeometry } from "./dashboard-geometry-check.mjs";
import { checkResponsiveGeometry } from "./responsive-geometry-check.mjs";
import { captureScreenshots, testDirectory } from "./run-options-and-work-folders.mjs";

await command("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, screenWidth: 900, screenHeight: 900, deviceScaleFactor: 1, mobile: false });
await waitFor("window.innerWidth===900 && matchMedia('(max-width:980px)').matches");
assert(await evaluate("(()=>{const nav=document.querySelector('.rail-nav');return getComputedStyle(nav).display==='grid'&&getComputedStyle(nav).gridTemplateColumns.trim().split(/\\s+/u)"
  + ".length===3&&nav.scrollWidth<=nav.clientWidth+1&&document.documentElement.scrollWidth<=window.innerWidth+1})()"), "900px navigation does not wrap into a contained three-column grid.");

await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true });
await waitFor("window.innerWidth===390");
assert(
  await evaluate("(()=>{const nav=document.querySelector('.rail-nav');return getComputedStyle(nav).gridTemplateColumns.trim().split(/\\s+/u).length===2&&nav.scrollWidth<=nav.clientWidth+1&&document.documentElement.scrollWidth<=window.innerWidth+1})()"),
  "390px navigation does not wrap into a contained two-column grid."
);
if (captureScreenshots) {
  await evaluate("window.scrollTo(0,0)");
  const capture = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
  await writeFile(path.join(testDirectory, "work-temp-dashboard-phone.png"), Buffer.from(capture.data, "base64"));
}

const responsiveWidths = [1780, 1600, 1401, 1400, 1280, 1100, 1016, 1000, 981, 980, 900, 640, 480, 390, 320];
for (const view of ['hangar', 'buybacks']) {
  await evaluate(`document.querySelector('[data-view="${view}"]').click()`);
  for (const width of responsiveWidths) {
    await setViewport(width);
    await checkResponsiveGeometry(`${view} at ${width}px`);
    await checkDashboardGeometry(`${view}, whole dashboard at ${width}px`);
    if ([1000, 640, 390].includes(width)) await checkCompactCollections(`${view}, compact collections at ${width}px`);
    if (captureScreenshots && view === 'hangar' && [1780, 1280, 1100, 1000, 390].includes(width)) {
      await evaluate("window.scrollTo(0,0)");
      await captureElement('#overview', `work-temp-overview-${width}.png`);
      await captureElement('#inventory', `work-temp-inventory-${width}.png`, 1600);
      if ([1280, 1000, 390].includes(width)) {
        await captureElement('#balances', `work-temp-balances-${width}.png`);
        await captureElement('#offlineImages', `work-temp-file-status-images-${width}.png`);
        await captureElement('#referrals', `work-temp-referrals-${width}.png`, 1800);
        await captureElement('#organizations', `work-temp-organizations-${width}.png`, 1800);
        await captureElement('.community-footer', `work-temp-footer-${width}.png`);
      }
    }
    if (captureScreenshots && view === 'buybacks' && [640, 390, 320].includes(width)) await captureElement('#inventory', `work-temp-buybacks-${width}.png`, 1600);
    if (captureScreenshots && view === 'hangar' && [1280,640,390,320].includes(width)) {
      await captureElement('#subscriptions', `work-temp-subscriptions-${width}.png`);
      await captureElement('.summary-strip', `work-temp-subscription-summary-${width}.png`);
    }
  }
}

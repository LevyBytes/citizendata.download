import { existsSync } from "node:fs";
import path from "node:path";
import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { repositoryRoot } from "./run-options-and-work-folders.mjs";

// The example account reads as an account that was built in full: its badges, its buy-backs, the figures of its
// images, and its section count. Under the footer there is no empty band unless Build Status is shown.
export async function checkExampleAccount() {
  for (const width of [1440, 380]) {
    await setViewport(width);
    await reloadDashboard();
    await waitFor("/^[0-9]+ unique images$/u.test(document.getElementById('mediaSummary').textContent)");
    const example = await evaluate(`(() => {
      const demo = window.CITIZENDATA_DEMO_DATA;
      const bundled = window.CITIZENDATA_DEMO_MEDIA;
      const named = new Set([...JSON.stringify(demo).matchAll(/"imageKey":"([0-9a-f]{64})"/g)].map((match) => match[1]));
      const text = (id) => document.getElementById(id).textContent;
      const gap = () => Math.round(document.documentElement.scrollHeight - (document.querySelector('.community-footer').getBoundingClientRect().bottom + window.scrollY));
      const overlay = document.getElementById('parserOverlay');
      const hiddenGap = overlay.hidden ? gap() : null;
      overlay.hidden = false;
      // With the page scrolled to its end, the footer ends this far up the window; Build Status starts at overlayTop.
      const shown = { gap: gap(), footerBottom: window.innerHeight - gap(), overlayTop: overlay.getBoundingClientRect().top };
      overlay.hidden = true;
      document.querySelector('[data-view="buybacks"]').click();
      const rows = [...document.querySelectorAll('#inventoryRows tr')];
      const eclipse = rows.find((row) => row.dataset.recordKey === 'demo-buyback-4');
      return {
        images: [...named].filter((key) => Object.hasOwn(bundled, key)).length, unbundled: [...named].filter((key) => !Object.hasOwn(bundled, key)),
        count: text('mediaAssetCount'), summary: text('mediaSummary'), status: text('mediaStatus'), file: text('imageFileStatus'), health: text('healthMedia'), loaded: !document.getElementById('mediaZipLoadedState').hidden,
        collection: text('healthCompleteness'), outcomes: Object.keys(demo.sync.sectionOutcomes).length,
        badges: [...document.querySelectorAll('#unlockedBadgeGrid a')].map((card) => [card.dataset.badgeId, card.getAttribute('aria-label'), card.querySelector('img').getAttribute('src')]),
        badgeCount: text('badgeSummaryCount'), badgeEmptyHidden: document.getElementById('unlockedBadgeEmpty').hidden,
        buybacks: rows.map((row) => row.dataset.recordKey), buybackTotal: text('buybackTotal'),
        eclipse: eclipse ? { text: eclipse.innerText.replace(/\\s+/g, ' ').trim(), image: eclipse.querySelector('.row-thumbnail')?.getAttribute('src') ?? null } : null,
        hiddenGap, shown
      };
    })()`);
    const images = String(example.images);
    assert(example.images > 0 && example.unbundled.length === 0, `${width}: the example names images the dashboard does not bundle: ${JSON.stringify(example.unbundled)}`);
    assert(example.count === images && example.summary === `${images} unique images` && example.status === `example-images.zip is open with ${images} images. Every image in this example is shown from `
      + `it.` && example.file === 'example-images.zip' && example.health === `${images} packaged images loaded` && example.loaded,
      `${width}: the example account's image figures do not read as a loaded Images ZIP: ${JSON.stringify(example)}`);
    assert(example.collection === `${example.outcomes} of ${example.outcomes} sections complete` && example.outcomes === 16, `${width}: the example account does not report every section an account build reads: ${example.collection}`);
    assert(JSON.stringify(example.badges) === JSON.stringify([
      ["577", "Aggressor. Open Star Citizen Wiki in a new tab.", "assets/badges/title-aggressor.png"],
      ["848", "Clearance Level Ultra. Open Star Citizen Wiki in a new tab.", "assets/badges/title-clearance-level-ultra.png"]
    ]) && example.badgeCount === "2 account badges" && example.badgeEmptyHidden,
      `${width}: the example account does not show its two badges: ${JSON.stringify(example.badges)} ${example.badgeCount}`);
    assert(JSON.stringify(example.buybacks) === JSON.stringify(["demo-buyback-2", "demo-buyback-1", "demo-buyback-4", "demo-buyback-3"]) && example.buybackTotal === "4"
      && example.eclipse?.text.includes("Standalone Ship - Aegis Eclipse LTI") && example.eclipse.text.includes("Contains Eclipse and 4 items") && example.eclipse.text.includes("May 19, 2017")
        && example.eclipse.image === "assets/demo/aegis-eclipse-lti.jpg",
      `${width}: the Eclipse buy-back is not in the example list with its date and image: ${JSON.stringify(example.buybacks)} ${JSON.stringify(example.eclipse)} total ${example.buybackTotal}`);
    assert(example.hiddenGap !== null && example.hiddenGap <= 26, `${width}: ${example.hiddenGap} pixels of empty page under the footer while Build Status is hidden.`);
    assert(example.shown.footerBottom <= example.shown.overlayTop, `${width}: Build Status covers the end of the footer when it is shown: ${JSON.stringify(example.shown)}`);
  }
  await setViewport(1440);
  for (const file of ["assets/demo/aegis-eclipse-lti.jpg", "assets/badges/title-aggressor.png", "assets/badges/title-clearance-level-ultra.png"]) assert(
    existsSync(path.join(repositoryRoot, "docs", file)), `The example account names a file the dashboard does not ship: ${file}`
  );
}

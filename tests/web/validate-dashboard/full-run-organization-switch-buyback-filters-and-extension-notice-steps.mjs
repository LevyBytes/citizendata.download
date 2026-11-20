import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkExtensionNotice } from "./extension-notice-check.mjs";
import { selectOrganization } from "./organization-selection-offline-placement-and-support-layout.mjs";
import { checkOwnerAvatar, checkPersonLinks } from "./owner-avatar-and-person-links-checks.mjs";
import { captureScreenshots, testDirectory } from "./run-options-and-work-folders.mjs";

await selectOrganization('MMHC');
await waitFor("document.querySelector('#organizationListTitle').textContent==='Million Mile High Club' && document.querySelectorAll('#organizationRows tr').length===8");
assert(
  await evaluate("!document.querySelector('#organizationSelector').open && document.activeElement===document.querySelector('#organizationSelector > summary')"),
  "Organization selection did not close its selector and return keyboard focus to the selector control."
);
await waitFor("(()=>{const image=document.querySelector('[data-organization-sid=\"MMHC\"] .membership-emblem');return image&&!image.hidden&&image.complete&&image.naturalWidth>0})()");
assert(await evaluate("(()=>{const button=document.querySelector('[data-organization-sid=\"MMHC\"]');const image=button.querySelector('img');return button.getAttribute('aria-pressed')==='true'&&button.textContent.includes('affiliate')"
  + "&&button.textContent.includes('117 members')&&image.getAttribute('src')==='assets/demo/mmhc-emblem.png'})()"), "MMHC affiliate did not render its local emblem and stated member count.");
await checkOwnerAvatar('#organizationRows', 'MMHC roster');
await checkPersonLinks('#organizationRows', "window.CITIZENDATA_DEMO_DATA.organizations.members.filter(member=>member.organizationSid==='MMHC')", 'MMHC member links and avatars', { localAvatars:true });
if (captureScreenshots) {
  await captureElement("#referrals", "work-temp-dashboard-referrals.png");
  await captureElement("#organizations", "work-temp-dashboard-organizations.png");
}
await selectOrganization('TEST');
assert(await evaluate("document.querySelectorAll('#organizationRows tr').length===15 && [...document.querySelectorAll('#organizationRows tr')].some(row=>row.innerText.includes('Redacted Member')&&row.cells[1].textContent.includes('—')"
  + "&&!row.cells[1].textContent.includes('@'))"), "Main organization switch lost the roster or invented redacted-member metadata.");

await evaluate("document.querySelector('[data-view=\"buybacks\"]').click()");
await waitFor("document.querySelectorAll('#inventoryRows tr').length===4");
assert(await evaluate("document.querySelectorAll('#inventoryRows .row-thumbnail:not([hidden])').length===4"), "Buyback thumbnails did not render locally.");
assert(await evaluate("[...document.querySelectorAll('#inventoryRows tr')].map(row=>row.dataset.recordKey).join(',')==='demo-buyback-2,demo-buyback-1,demo-buyback-4,demo-buyback-3'"), "Example buybacks must display newest first.");
await evaluate("document.querySelector('#filterButton').click(); document.querySelector('.filter-chip[data-group=\"gamePackage\"]').click()");
assert(await evaluate("document.querySelector('#filterCount').textContent==='1' && document.querySelectorAll('#inventoryRows tr').length===1"), "Category filter fixture did not narrow the buybacks.");
await evaluate("document.querySelector('[data-view=\"hangar\"]').click()");
assert(
  await evaluate("document.querySelector('#filterCount').textContent==='0' && document.querySelector('.filter-chip[data-group=\"all\"]').getAttribute('aria-pressed')==='true' && document.querySelectorAll('#inventoryRows tr').length===3"),
  "Switching inventory reset the records but retained a stale filter count or category."
);
await evaluate("document.querySelector('#filterButton').click(); document.querySelector('[data-view=\"buybacks\"]').click()");

await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, screenWidth: 1280, screenHeight: 1000, deviceScaleFactor: 1, mobile: false });
await waitFor("window.innerWidth===1280");
assert(await evaluate("(()=>{const record=document.querySelector('.uee-record');const label=record.children[0].getBoundingClientRect();const number=record.children[1].getBoundingClientRect();const beside=Math.abs(number.top-label.top)<2&&number.left>"
  + "=label.right-1;return record.getClientRects().length===1&&beside&&document.documentElement.scrollWidth<=window.innerWidth+1})()"), "UEE Citizen label and number did not remain inline at 1280px.");
if (captureScreenshots) {
  await evaluate("window.scrollTo(0,0)");
  const capture = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
  await writeFile(path.join(testDirectory, "work-temp-dashboard-1280.png"), Buffer.from(capture.data, "base64"));
}

await checkExtensionNotice();

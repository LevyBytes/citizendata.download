import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { exampleRecruitDates } from "./example-recruit-dates-and-order-check.mjs";
import { checkOwnerAvatar, checkPersonLinks } from "./owner-avatar-and-person-links-checks.mjs";
import { captureScreenshots, testDirectory } from "./run-options-and-work-folders.mjs";

assert(await evaluate("(()=>{const balance=document.querySelector('#balances').getBoundingClientRect();const health=document.querySelector('#offlineImages').getBoundingClientRect();return balance.top<health.top&&Math.abs(balance.left-health.left)"
  + "<1&&Math.abs(balance.width-health.width)<1})()"), "Balances is not a full-width widget before File Status and Images.");
assert(
  await evaluate("!document.querySelector('#avatarImage').hidden && !document.querySelector('#dossierBadgeImage').hidden && !document.querySelector('#organizationEmblemImage').hidden"),
  "Example avatar, dossier badge, or organization emblem did not render."
);
assert(await evaluate("document.querySelectorAll('#inventoryRows .row-thumbnail:not([hidden])').length===3"), "Current Hangar thumbnails did not render locally.");
assert(await evaluate("[...document.querySelectorAll('#inventoryRows tr')].map(row=>row.dataset.recordKey).join(',')==='demo-pledge-3,demo-pledge-2,demo-pledge-1'"), "Example pledges must display newest first.");
await evaluate("document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-1\"] .record-button').click()");
assert(
  await evaluate("document.querySelectorAll('#inspectorItemList .inspector-item').length===4 && !document.querySelector('#inspectorItemsToggle').hidden && document.querySelector('#inspectorItemsToggle').textContent.includes('11')"),
  "Weekend Warrior contained-item preview did not render its expansion control."
);
await evaluate("document.querySelector('#inspectorItemsToggle').click()");
assert(await evaluate("document.querySelectorAll('#inspectorItemList .inspector-item').length===11 && document.querySelector('#inspectorItemsToggle').getAttribute('aria-expanded')==='true' && document.querySelector('#inspectorItemList')"
  + ".innerText.includes('Model II Arclight Sidearm')"), "Show all items did not expose every contained item.");
await evaluate("document.querySelector('#inspectorItemsToggle').click()");
assert(
  await evaluate("document.querySelectorAll('#inspectorItemList .inspector-item').length===4 && document.querySelector('#inspectorItemsToggle').getAttribute('aria-expanded')==='false'"),
  "Contained items did not collapse to their original preview."
);
await evaluate("document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-3\"] .record-button').click()");
assert(await evaluate("document.querySelectorAll('#inspectorItemList .inspector-item').length===1 && document.querySelector('#inspectorItemsToggle').hidden"), "A single-item pledge retained an unnecessary expansion control.");
await evaluate("document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-1\"] .record-button').click()");
assert(await evaluate("document.querySelectorAll('[data-referral-path]').length===4"), "Referral ladder controls are incomplete.");
assert(await evaluate(`(() => {
  const rows = [...document.querySelectorAll('#organizationRows tr')];
  const expectedHandles = ['Montoya', 'DirectorGunner', 'ChromeNinja', 'O-Lefty', 'wmk', 'Tincup', 'Knax', 'mromutt', 'Citizen404', 'GOD_Shive', 'Xist', 'MunkenTEST', 'Krystal', 'Arrangingstars'];
  const members = window.CITIZENDATA_DEMO_DATA.organizations.members;
  const test = members.filter(member => member.organizationSid === 'TEST');
  const mmhc = members.filter(member => member.organizationSid === 'MMHC');
  const actualHandles = test.filter(member => member.visibility === 'public').map(member => member.handle);
  const expectedMmhcHandles = ['DirectorGunner', 'Xist', 'SpearmintVR', 'Proxus-CIG', 'Morphologis', 'CZenStar', 'Lady_Glume'];
  const actualMmhcHandles = mmhc.filter(member => member.visibility === 'public').map(member => member.handle);
  const memberships = window.CITIZENDATA_DEMO_DATA.organizations.memberships;
  const forbiddenHandles = ['AsterVale', 'CassArden', 'NovaFinch', 'OrionPike', 'IrisNorth', 'MiloHart', 'VegaShore', 'TarinGrey', 'SoraBell', 'EliRowan'];
  return rows.length === 15 && test.length === 15 && mmhc.length === 8
    && rows[0].cells[1].textContent.includes('@Montoya')
    && expectedHandles.every(handle => actualHandles.includes(handle)) && actualHandles.length === expectedHandles.length
    && expectedMmhcHandles.every(handle => actualMmhcHandles.includes(handle)) && actualMmhcHandles.length === expectedMmhcHandles.length
    && !members.some(member => forbiddenHandles.includes(member.handle))
    && memberships.find(item => item.sid === 'TEST').memberCount === 24652
    && memberships.find(item => item.sid === 'MMHC').memberCount === 117
    && document.querySelector('[data-organization-sid="TEST"]').textContent.includes('24,652 members')
    && [...document.querySelectorAll('#organizations th')].map(node => node.textContent.trim()).join('|') === 'Moniker|Username|Rank|Role|Membership';
})()`), "Public example organization rows, counts, Montoya ordering, or column order are incorrect.");
await checkOwnerAvatar('#organizationRows', 'TEST roster');
await checkPersonLinks('#organizationRows', "window.CITIZENDATA_DEMO_DATA.organizations.members.filter(member=>member.organizationSid==='TEST')", 'TEST member links and avatars', { localAvatars:true });
assert(await evaluate(`(() => {
  const dates = ${JSON.stringify(exampleRecruitDates)};
  const members = window.CITIZENDATA_DEMO_DATA.organizations.members.filter(member => member.visibility === 'public');
  const handles = new Set(members.map(member => member.handle));
  if (handles.size !== 19 || Object.keys(window.CITIZENDATA_PROFILE_AVATARS).length !== 19) return false;
  return ['current', 'legacy'].every(ladder => {
    const recruits = window.CITIZENDATA_DEMO_DATA.referrals[ladder].recruits;
    const prospects = window.CITIZENDATA_DEMO_DATA.referrals[ladder].prospects;
    return recruits.some(record => record.handle === 'DirectorGunner')
      && recruits.every(record => record.handle !== 'Montoya' && handles.has(record.handle) && members.some(member => member.handle === record.handle && member.displayName === record.displayName)
        && record.dateLabel === 'purchasedOn' && record.dateRaw === dates[record.handle]?.[0] && record.dateSortKey === dates[record.handle]?.[1])
      && new Set(recruits.map(record => record.handle)).size === recruits.length
      && prospects.every(record => !handles.has(record.handle));
  });
})()`), "Example recruits must use named roster members, retain DirectorGunner, exclude Montoya, keep the existing date label, and use the researched public dossier dates; prospects must remain fictional.");
assert(await evaluate("document.querySelector('#displayTitle').textContent==='Clearance Level Ultra' && !document.querySelector('#overview').innerText.includes('Pathfinder') && document.querySelector('#overview').innerText.split('Clearance Level Ultra')"
  + ".length===2"), "Example badge did not replace the obsolete title exactly once.");
for (const variant of ['radar', 'holo-render', 'staff-pick', 'customize']) {
  await evaluate(`document.querySelector('#identityHeroArt').dataset.heroArt=${JSON.stringify(variant)}`);
  assert(await evaluate("(()=>{const panel=document.querySelector('.identity-panel').getBoundingClientRect();const art=document.querySelector('#identityHeroArt').getBoundingClientRect();return Math.abs(art.left+art.width/2-(panel.right-28))"
    + "<=2&&Math.abs(art.top+art.height/2-(panel.top+28))<=2&&art.bottom-panel.top>=203})()"), `Hero artwork ${variant} is not inset 28px left/down from the top-right corner.`);
  if (captureScreenshots) await captureElement('#overview', `work-temp-hero-${variant}.png`);
}
await evaluate("document.querySelector('#identityHeroArt').dataset.heroArt='radar'");
assert(await evaluate("document.querySelector('#overlaySummary').textContent==='DISCONNECTED' && document.querySelector('#overlayState').textContent==='Extension connection unavailable' && document.querySelector('#buildButtonLabel')"
  + ".textContent==='Build' && !document.body.innerText.includes('collection complete')"), "Disconnected example source fakes a successful account build or loses the Build action.");
assert(await evaluate("document.querySelector('#parserOverlay').hidden === true"), "The parsing overlay is visible while no collection run exists.");
if (captureScreenshots) {
  const capture = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
  await writeFile(path.join(testDirectory, "work-temp-dashboard-desktop.png"), Buffer.from(capture.data, "base64"));
}

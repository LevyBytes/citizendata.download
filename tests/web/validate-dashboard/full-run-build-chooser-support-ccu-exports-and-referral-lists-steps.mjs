import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkExampleCcuHistory } from "./example-ccu-history-checks.mjs";
import { checkExampleExports } from "./example-exports-check.mjs";
import { checkExampleRecruitOrder } from "./example-recruit-dates-and-order-check.mjs";
import { checkFloatingGeometry } from "./geometry-probe-prelude-and-floating-geometry-check.mjs";
import { checkSupportPanelLayout } from "./organization-selection-offline-placement-and-support-layout.mjs";
import { checkOwnerAvatar, checkPersonLinks } from "./owner-avatar-and-person-links-checks.mjs";
import { captureScreenshots } from "./run-options-and-work-folders.mjs";

await evaluate("document.querySelector('#buildButton').click()");
await waitFor("!document.querySelector('#parserOverlay').hidden && !document.querySelector('#buildChoices').hidden");
assert(await evaluate("document.querySelector('#buildAccountAction').disabled && document.querySelector('#buildImagesAction').disabled && document.querySelector('#overlayState').textContent==='Before you can build' && "
  + "document.querySelector('#overlayDetail').textContent==='Data needs the CitizenData extension. Images need an open account document.'"), "Disconnected Build Status choices did not prevent automatic work or say what each choice needs.");
for (const [width,height] of [[1780,1000],[1000,1000],[390,844]]) {
  await setViewport(width,height);
  await checkFloatingGeometry('#parserOverlay', `disconnected Build Status choices at ${width}px`);
  if (captureScreenshots) await captureElement('#parserOverlay', `work-temp-build-status-${width}.png`);
}
await evaluate("document.querySelector('#closeOverlay').click()");
await setViewport(1600,1800);

await checkSupportPanelLayout();
await checkExampleCcuHistory();
await checkExampleExports();

await evaluate("document.querySelector('[data-referral-path=\"legacy.recruits\"]').click()");
await waitFor("document.querySelector('#referralListTitle').textContent==='Legacy recruits'");
assert(await evaluate("document.activeElement.dataset.referralPath==='legacy.recruits'"), "Referral selection discarded keyboard focus.");
await checkExampleRecruitOrder('legacy', 'newest');
await evaluate("document.querySelector('#referralSortButton').click()");
await checkExampleRecruitOrder('legacy', 'oldest');
assert(await evaluate("document.querySelector('#referralSortButton').textContent.includes('Oldest first')"), "Referral sort label did not update.");
for (const listPath of ['current.prospects', 'current.recruits', 'legacy.prospects', 'legacy.recruits']) {
  await evaluate(`document.querySelector('[data-referral-path="${listPath}"]').click()`);
  assert(await evaluate(`(() => {
    const [ladder, kind] = ${JSON.stringify(listPath)}.split('.');
    const expected = window.CITIZENDATA_DEMO_DATA.referrals[ladder][kind];
    const rows = [...document.querySelectorAll('#referralRows tr')];
    return rows.length === expected.length && rows.every(row => row.cells.length === 3) && document.querySelector('[data-referral-path="${listPath}"]').getAttribute('aria-pressed') === 'true';
  })()`), `Referral list ${listPath} did not retain its records and three fields.`);
  const isRecruitList = listPath.endsWith('.recruits');
  if (isRecruitList) {
    await checkOwnerAvatar('#referralRows', listPath);
    await checkExampleRecruitOrder(listPath.split('.')[0], 'oldest');
    await evaluate("document.querySelector('#referralSortButton').click()");
    await checkExampleRecruitOrder(listPath.split('.')[0], 'newest');
    await evaluate("document.querySelector('#referralSortButton').click()");
  }
  await checkPersonLinks('#referralRows', `window.CITIZENDATA_DEMO_DATA.referrals.${listPath}`, `${listPath} profile links`, { demoProspects:!isRecruitList, localAvatars:isRecruitList });
}
await evaluate("(()=>{document.querySelector('[data-referral-path=\"current.recruits\"]').click();const input=document.querySelector('#referralSearch');input.value='DirectorGunner';input.dispatchEvent(new Event('input',{bubbles:true}))})()");
await waitFor("document.querySelector('#referralListTitle').textContent==='Current recruits' && document.querySelectorAll('#referralRows tr').length===1 && document.querySelector('#referralRows').textContent.toLowerCase().includes('directorgunner')");
assert(await evaluate("document.querySelector('#referralSearchCount').textContent==='1 match' && document.querySelector('#referralPageStatus').textContent.includes('1 match')"), "Referral search did not report the current-view match.");
await evaluate("document.querySelector('[data-referral-path=\"legacy.recruits\"]').click()");
await waitFor("document.querySelector('#referralListTitle').textContent==='Legacy recruits' && document.querySelectorAll('#referralRows tr').length===1 && document.querySelector('#referralRows').textContent.toLowerCase().includes('directorgunner')");
await evaluate("(()=>{const input=document.querySelector('#referralSearch');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))})()");
await waitFor("document.querySelectorAll('#referralRows tr').length===window.CITIZENDATA_DEMO_DATA.referrals.legacy.recruits.length && document.querySelector('#referralSearchCount').textContent==='' ");

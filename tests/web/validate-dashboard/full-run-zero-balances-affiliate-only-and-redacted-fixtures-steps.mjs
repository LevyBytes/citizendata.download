import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { selectOrganization } from "./organization-selection-offline-placement-and-support-layout.mjs";

await loadFixture('zero-balances.json', "for (const balance of Object.values(documentCopy.financial.balances)) balance.amount = '0';");
assert(
  await evaluate("document.querySelector('#storeCredit').textContent==='$0.00' && document.querySelector('#uecBalance').textContent==='0' && document.querySelector('#detailRec').textContent==='0'"),
  "Real zero balances were incorrectly hidden as unavailable."
);

await loadFixture('affiliate-only.json', `
  documentCopy.profile.mainOrganizationSid = null;
  documentCopy.profile.organizationRank = null;
  documentCopy.organizations.memberships = documentCopy.organizations.memberships.filter(member => member.sid === 'MMHC');
  documentCopy.organizations.members = documentCopy.organizations.members.filter(member => member.organizationSid === 'MMHC');
`);
assert(await evaluate("document.querySelector('#mainOrganization').textContent==='No main organization' && document.querySelector('#organizationRank').textContent==='Unavailable' && document.querySelector('#organizationEmblemImage').hidden && "
  + "document.querySelector('#organizationListTitle').textContent==='Million Mile High Club'"), "Affiliate-only account was falsely assigned a main organization or lost its affiliate roster.");

await evaluate("window.__previousOfflineMedia = window.CITIZENDATA_OFFLINE_MEDIA; window.CITIZENDATA_OFFLINE_MEDIA = window.CITIZENDATA_DEMO_MEDIA");
await loadFixture('redacted-with-stale-fields.json', `
  const owner = documentCopy.organizations.members.find(member => member.handle === 'DirectorGunner');
  for (const member of documentCopy.organizations.members.filter(member => member.visibility !== 'public')) {
    member.displayName = 'StalePrivateMoniker';
    member.handle = 'StalePrivateHandle';
    member.images = structuredClone(owner.images);
  }
`);
for (const sid of ['TEST', 'MMHC']) {
  await selectOrganization(sid);
  assert(await evaluate(`(() => {
    const rows = [...document.querySelectorAll('#organizationRows tr')];
    const row = rows.find(item => item.cells[0].textContent.includes('Redacted Member'));
    return row && !row.innerText.includes('StalePrivate') && !row.cells[1].textContent.includes('@')
      && ![...row.querySelectorAll('img')].some(image => !image.hidden || image.hasAttribute('src'))
      && !row.querySelector('a') && !row.outerHTML.includes('StalePrivate');
  })()`), `${sid}: redacted member leaked stale identity fields or an avatar.`);
}
await evaluate("window.CITIZENDATA_OFFLINE_MEDIA = window.__previousOfflineMedia");

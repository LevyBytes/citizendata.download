import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { assertCollectionAtTop, scrollCollectionToBottom } from "./compact-collections-check-and-collection-scrolling.mjs";
import { selectOrganization } from "./organization-selection-offline-placement-and-support-layout.mjs";

await loadFixture('pagination-fixture.json', `
  const referralTemplate = documentCopy.referrals.current.prospects[0];
  documentCopy.referrals.current.prospects = Array.from({length:30}, (_, index) => ({
    ...referralTemplate, recordKey:'pagination-referral-' + index,
    displayName:'PaginationReferral' + String(index).padStart(2,'0'), handle:'PaginationReferral' + index,
    dateRaw:'January ' + (index + 1) + ', 2950', dateSortKey:'2950-01-' + String(index + 1).padStart(2,'0'), images:[]
  }));
  const memberTemplate = documentCopy.organizations.members.find(member => member.organizationSid === 'TEST' && member.visibility === 'public');
  documentCopy.organizations.members = [
    ...Array.from({length:30}, (_, index) => ({
      ...memberTemplate, recordKey:'pagination-member-' + index,
      displayName:'PaginationMember' + String(index).padStart(2,'0'), handle:'PaginationMember' + index, images:[]
    })),
    ...documentCopy.organizations.members.filter(member => member.organizationSid === 'MMHC')
  ];
`);
await setViewport(390);
assert(await evaluate("document.querySelectorAll('#referralRows tr').length===25 && document.querySelector('#referralRows tr').cells[0].textContent.includes('PaginationReferral29') && document.querySelector('#referralPrevious').disabled && "
  + "!document.querySelector('#referralNext').disabled"), "Referral pagination did not start with the newest 25 records.");
// Five compact rows now fit in the normal pane. Bound this fixture's pane
// so second-page scroll restoration still exercises a real scroll offset.
await evaluate("document.querySelectorAll('.collection-table-shell').forEach(shell => { shell.style.maxHeight='120px'; })");
await scrollCollectionToBottom('referralRows');
await evaluate("document.querySelector('#referralNext').click()");
await assertCollectionAtTop('referralRows', 'Referral next page');
assert(await evaluate("document.querySelectorAll('#referralRows tr').length===5 && document.querySelector('#referralRows tr').cells[0].textContent.includes('PaginationReferral04') && document.querySelector('#referralNext').disabled && "
  + "!document.querySelector('#referralPrevious').disabled"), "Referral second page did not contain the remaining five records.");
await scrollCollectionToBottom('referralRows');
await evaluate("document.querySelector('#referralPrevious').click()");
await assertCollectionAtTop('referralRows', 'Referral previous page');
await scrollCollectionToBottom('referralRows');
await evaluate("document.querySelector('#referralSortButton').click()");
await assertCollectionAtTop('referralRows', 'Referral sort');
assert(
  await evaluate("document.querySelector('#referralRows tr').cells[0].textContent.includes('PaginationReferral00') && document.querySelector('#referralPageStatus').textContent.includes('page 1 of 2')"),
  "Referral sorting did not restart at the oldest record on page one."
);
await scrollCollectionToBottom('referralRows');
await evaluate("document.querySelector('[data-referral-path=\"current.recruits\"]').click()");
await assertCollectionAtTop('referralRows', 'Referral list switch');

assert(await evaluate("document.querySelectorAll('#organizationRows tr').length===25 && document.querySelector('#organizationRows tr').cells[0].textContent.includes('PaginationMember00') && document.querySelector('#organizationPrevious').disabled && "
  + "!document.querySelector('#organizationNext').disabled"), "Organization pagination did not begin with the first 25 members.");
await scrollCollectionToBottom('organizationRows');
await evaluate("document.querySelector('#organizationNext').click()");
await assertCollectionAtTop('organizationRows', 'Organization next page');
assert(await evaluate("document.querySelectorAll('#organizationRows tr').length===5 && document.querySelector('#organizationRows tr').cells[0].textContent.includes('PaginationMember25') && document.querySelector('#organizationNext').disabled && "
  + "!document.querySelector('#organizationPrevious').disabled"), "Organization second page did not contain the remaining five members.");
await scrollCollectionToBottom('organizationRows');
await evaluate("document.querySelector('#organizationPrevious').click()");
await assertCollectionAtTop('organizationRows', 'Organization previous page');
await scrollCollectionToBottom('organizationRows');
await selectOrganization('MMHC');
await assertCollectionAtTop('organizationRows', 'Organization switch');
assert(await evaluate("document.querySelectorAll('#organizationRows tr').length===8 && document.querySelector('#organizationPageStatus').textContent.includes('page 1 of 1')"), "Organization switch retained a page from the previous organization.");
await evaluate("document.querySelectorAll('.collection-table-shell').forEach(shell => { shell.style.removeProperty('max-height'); })");

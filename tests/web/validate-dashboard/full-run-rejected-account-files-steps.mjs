import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

const invalidMutations = [
  ['null-pledge', 'documentCopy.pledges[0] = null;'],
  ['null-buyback', 'documentCopy.buybacks[0] = null;'],
  ['null-referral', 'documentCopy.referrals.current.prospects[0] = null;'],
  ['null-membership', 'documentCopy.organizations.memberships[0] = null;'],
  ['null-member', 'documentCopy.organizations.members[0] = null;'],
  ['invalid-images', 'documentCopy.pledges[0].images = {};'],
  ['invalid-balance', "documentCopy.financial.balances.uec.amount = 'not-a-number';"],
  ['invalid-subscription-list', 'documentCopy.financial.subscriptions = {};'],
  ['null-subscription', 'documentCopy.financial.subscriptions[0] = null;'],
  ['invalid-subscription-plan', 'documentCopy.financial.subscriptions[0].plan = {};'],
  ['invalid-subscription-payments', 'documentCopy.financial.subscriptions[0].payments = {};'],
  ['invalid-subscription-money', "documentCopy.financial.subscriptions[0].totalPaid.amount = 'not-a-number';"],
  ['missing-subscriptions', 'delete documentCopy.financial.subscriptions;'],
  ['null-subscriptions', 'documentCopy.financial.subscriptions = null;'],
  ['missing-balances', "delete documentCopy.financial.balances.storeCredit; delete documentCopy.financial.balances.uec; delete documentCopy.financial.balances.rec;"],
  ['invalid-category', "documentCopy.pledges[0].category = 'toString';"],
  ['missing-and-invalid-handles', `
    const invalidHandles = [null, '', 'bad handle', '../escaped', 'bad/handle', 'bad?query', 'bad#fragment', 'bad%2fhandle', 'https://invalid.example'];
    const member = documentCopy.organizations.members.find(record => record.visibility === 'public' && record.organizationSid === 'TEST');
    documentCopy.organizations.members = invalidHandles.map((handle,index) => ({
      ...member, recordKey:'invalid-member-' + index, displayName:'Invalid member ' + index, handle, images:[]
    }));
    const prospect = documentCopy.referrals.current.prospects[0];
    documentCopy.referrals.current.prospects = invalidHandles.map((handle,index) => ({
      ...prospect, recordKey:'invalid-prospect-' + index, displayName:'Invalid prospect ' + index, handle, images:[]
    }));
  `]
];
const snapshotExpression = `JSON.stringify(['#accountHandle','#railExported','#inventoryRows','#referralRows','#organizationRows','#storeCredit','#uecBalance','#detailRec','#billingTotal','#subscriptionSummary','#subscriptions'].map(selector => `
  + `document.querySelector(selector).outerHTML))`;
const goodSnapshot = await evaluate(snapshotExpression);
for (const [name, mutation] of invalidMutations) {
  await evaluate(`(async () => {
    const documentCopy = structuredClone(window.CITIZENDATA_DEMO_DATA);
    ${mutation}
    const stampedDocument = await window.CitizenDataAccountDocument.stampIntegrity(documentCopy);
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(stampedDocument)], ${JSON.stringify(`${name}.json`)}, {type:'application/json'}));
    const input = document.querySelector('#jsonFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor("document.querySelector('#messageDialog').open && document.querySelector('#messageDialog h2').textContent==='File rejected'");
  assert(await evaluate(snapshotExpression) === goodSnapshot, `${name}: invalid JSON replaced or partially changed the previous good UI.`);
  await evaluate("document.querySelector('#messageDialog').close()");
}

for (const [name, mutation] of [
  ['null-balances', "documentCopy.financial.balances.storeCredit = null; documentCopy.financial.balances.uec = null; documentCopy.financial.balances.rec = null;"]
]) {
  await loadFixture(`${name}.json`, mutation);
  assert(await evaluate("['storeCredit','uecBalance','detailStoreCredit','detailUec','detailRec'].every(id=>document.getElementById(id).textContent.trim()==='—')"), `${name}: unavailable balances were displayed as zero or as a currency amount.`);
}

import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { chooseExport, downloadExport } from "./export-dialog-and-download.mjs";

export async function checkLoadedExports() {
  await loadFixture('export-fixture.json', `
    const inventory = documentCopy.pledges[0];
    documentCopy.pledges = Array.from({length:30},(_,index)=>({...inventory,recordKey:'export-pledge-'+index,title:'Inventory'+String(index).padStart(2,'0'),category:index%2?'reward':'gamePackage'}));
    const person = documentCopy.referrals.current.prospects[0];
    documentCopy.referrals.current.prospects = Array.from({length:30},
      (_,index)=>({...person,recordKey:'export-referral-'+index,displayName:'ExportReferral'+index,handle:'ExportReferral'+index,dateRaw:'January '+(index+1)+', 2950',dateSortKey:'2950-01-'+String(index+1).padStart(2,'0')}));
    const rawDetail = 'Café Ω — reward'+String.fromCharCode(10)+'Second line'+String.fromCharCode(9)+'東京';
    const observation = structuredClone(documentCopy.profile.observation);
    const log = {fingerprint:'a'.repeat(64),occurrenceOrdinal:1,rawTimestamp:'November 17, 2026, 6:28 am',subjectId:42,subjectName:'Unchanged Ω name',kind:'Reward',rawDetail,parsed:{mustNotExport:true},observation};
    documentCopy.hangarLog = [log,{...log,occurrenceOrdinal:2},{...log,fingerprint:'b'.repeat(64),subjectId:43,subjectName:'Gift pending',rawDetail:'Gift pending'}];
    documentCopy.financial.balances.storeCredit.amount = '9007199254740993.0001';
    documentCopy.financial.billingTotal.amount = '123456789012345.6789';
    documentCopy.financial.creditLedgers.storeCredit = [{fingerprint:'c'.repeat(64),occurrenceOrdinal:1,rawTimestamp:'November 17, 2026',rawDetail:'Adjustment Ω',amount:'-0.0001',unit:'USD',parsed:{kind:'adjustment'},observation}];
    const exactMoney = {amount:'9999999999999999.9999',currency:'USD'};
    const zeroMoney = {amount:'0.00',currency:'USD'};
    documentCopy.financial.orders = [{
      orderId:'order-exact',placedAtRaw:'November 17, 2026',storefront:'RSI',status:'closed',paymentState:'paid',fulfillmentState:null,physical:false,
      items:[{name:'Precision item',quantity:1,unitPrice:exactMoney,discount:zeroMoney,total:exactMoney,physical:false,trackingAvailable:false,images:[]}],
      billingAddress:null,shippingAddress:null,itemsTotal:exactMoney,additionalDiscount:zeroMoney,creditsUsed:zeroMoney,shippingAndHandling:null,tax:null,
      total:exactMoney,payments:[],invoiceAvailable:false,observation
    }];
    window.__exportFixture = structuredClone(documentCopy);
  `);
  await evaluate("document.querySelector('#filterButton').click(); document.querySelector('[data-group=reward]').click(); const search=document.querySelector('#recordSearch'); search.value='Inventory01'; search.dispatchEvent(new Event('input',"
    + "{bubbles:true})); document.querySelector('#referralNext').click()");
  assert(await evaluate("document.querySelectorAll('#inventoryRows tr').length===1 && document.querySelectorAll('#referralRows tr').length===5"), 'Export fixture did not establish active filters and a second referral page.');
  await evaluate("document.querySelector('#exportButton').click()");
  await chooseExport({exportPreset:'inventory',exportInventoryScope:'both',exportFormat:'native'});
  const expectedCount = await evaluate('window.__exportFixture.pledges.length+window.__exportFixture.buybacks.length');
  assert(await evaluate('document.querySelector("#exportSummary").textContent') === `${expectedCount} records · export-fixture.json`, 'Loaded export count/source filename is incorrect.');
  const inventory = await downloadExport('citizendata-hangar-and-buybacks.json');
  assert(inventory.pledges.length===30 && JSON.stringify(inventory.pledges)===await evaluate('JSON.stringify(window.__exportFixture.pledges)'), 'Inventory download exported only filtered/visible records.');
  assert(JSON.stringify(inventory.buybacks)===await evaluate('JSON.stringify(window.__exportFixture.buybacks)'), 'Both inventory sources did not survive the actual download.');
  await chooseExport({exportPreset:'referrals',exportReferralLadder:'current',exportReferralKind:'prospects'});
  const referrals = await downloadExport('citizendata-referrals-current-prospects.json');
  assert(referrals.referrals.current.prospects.length===30 && JSON.stringify(referrals.referrals.current.prospects)===await evaluate('JSON.stringify(window.__exportFixture.referrals.current.prospects)'), 'Referral download exported only the active page.');
  await chooseExport({exportPreset:'hangar-log'});
  const log = await downloadExport('citizendata-hangar-log.json');
  const expectedLog = await evaluate('window.__exportFixture.hangarLog.map(({rawTimestamp,subjectId,subjectName,rawDetail})=>({rawTimestamp,subjectId,subjectName,rawDetail}))');
  assert(Array.isArray(log) && log.length===3 && JSON.stringify(log)===JSON.stringify(expectedLog), 'Raw log download changed source order, duplicate rows, or raw wording.');
  assert(
    log.every(record=>Object.keys(record).sort().join('|')==='rawDetail|rawTimestamp|subjectId|subjectName') && JSON.stringify(log[0])===JSON.stringify(log[1]) && log[0].rawDetail.includes('\n') && log[0].rawDetail.includes('東京'),
    'Raw log download did not preserve exactly four raw fields, Unicode, newline, and duplicates.'
  );
  await chooseExport({exportPreset:'billing'});
  const billing = await downloadExport('citizendata-billing.json');
  assert(JSON.stringify(billing.financial)===await evaluate('JSON.stringify(window.__exportFixture.financial)'), 'Actual billing download altered source financial fields.');
  assert(
    billing.financial.balances.storeCredit.amount==='9007199254740993.0001' && billing.financial.billingTotal.amount==='123456789012345.6789' && billing.financial.orders[0].total.amount==='9999999999999999.9999',
    'Billing download rounded exact decimal money strings.'
  );
  await evaluate("document.querySelector('#exportClose').click()");
  assert(
    await evaluate("document.querySelectorAll('#inventoryRows tr').length===1 && document.querySelectorAll('#referralRows tr').length===5 && document.querySelector('#recordSearch').value==='Inventory01'"),
    'Export changed the loaded document filters or pagination state.'
  );
}

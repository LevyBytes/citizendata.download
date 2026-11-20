import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

await loadFixture('referral-unavailable-identity.json', `
  const template = documentCopy.referrals.legacy.prospects[0];
  documentCopy.referrals.legacy.prospects = [{
    ...template,
    recordKey:'legacy-redacted',displayName:null,handle:null,displayNameRaw:'',nicknameRaw:null,
    dateLabel:'enlistedOn',dateRaw:'2016-01-02T03:04:05Z',dateSortKey:'2016-01-02',images:[]
  }];
  documentCopy.dataQuality = {anomalies:[{
    anomalyKey:'referrals.legacy.prospects:2805:29',section:'referrals.legacy.prospects',recordIndex:2805,pageOrBatch:29,
    issueCode:'RSI_REFERRAL_RECORD_DISPLAY_NAME_EMPTY_NICKNAME_NULL',message:'Unexpected source identity retained.',
    raw:{id:'legacy-redacted',displayName:'',nickname:null,enlistedOn:'2016-01-02T03:04:05Z'},retainedInNormalizedData:true,
    observedAt:documentCopy.exportedAt,sourceUrls:['https://robertsspaceindustries.com/graphql']
  }]};
  documentCopy.sync.sectionOutcomes['referrals.legacy.prospects'].warnings = ['1 legacy prospects record contained unexpected source values; exact raw evidence was retained in dataQuality.anomalies.'];
`);
await evaluate("document.querySelector('[data-referral-path=\"legacy.prospects\"]').click()");
assert(await evaluate(`(() => {
  const row=document.querySelector('#referralRows tr');
  return document.querySelector('#referralOutcome').textContent.includes('1 raw data warning')
    && document.querySelector('#documentStatusDetail').textContent.includes('1 raw data warning')
    && row.cells[0].textContent.includes('Unavailable')
    && row.cells[1].textContent.includes('—')
    && row.cells[2].textContent.includes('2016-01-02T03:04:05Z')
    && !row.querySelector('a');
})()`), "Identity-unavailable referral was dropped, linked, or hidden without its raw data warning.");
await evaluate("document.querySelector('#loadReceiptButton').click()");
assert(await evaluate("document.querySelector('#messageDialog p').textContent.includes('1 raw source record warning was retained')"), "File details omitted retained anomaly evidence.");
await evaluate("document.querySelector('#messageDialog').close()");

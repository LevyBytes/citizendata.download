import { extensionMessage } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

// The stand-in extension the Switch Account check talks to (account-switch-with-extension-check.mjs): the accounts it
// lists, `asked` for the requests the page sent it, and `connect`, which answers as an extension that keeps accounts.
// REMOVE_ACCOUNT is answered with `window.__bridge.removeAnswer`, or as removed with `removeSelects` selected.
export const KEPT = "{key:'rsi:keptcitizen',handle:'KeptCitizen',displayName:'Kept Pilot',registered:false,hasRetainedBuild:true,retainedExportedAt:'2026-11-21T00:00:00.000Z'}";
export const ADDED = "{key:'rsi:addedcitizen',handle:'AddedCitizen',displayName:'Added Pilot',registered:true,hasRetainedBuild:false,retainedExportedAt:null}";
export const NEW = "{key:'rsi:newcitizen',handle:'NewCitizen',displayName:null,registered:true,hasRetainedBuild:false,retainedExportedAt:null}";
export const asked = (type) => `window.__bridge.requests.filter(([kind])=>kind==='${type}').map(([,payload])=>payload)`;

export const connect = (listed) => evaluate(`(async()=>{
  const session=crypto.randomUUID(),nonce='a'.repeat(40),listed=${listed};
  const send=(type,requestId,payload)=>${extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:2,type,requestId,bridgeSessionId:session,nonce,payload}")};
  const kept=structuredClone(window.CITIZENDATA_DEMO_DATA);kept.account.handle='KeptCitizen';kept.profile.handle='KeptCitizen';kept.profile.displayName='Kept Pilot';
  const build=await window.CitizenDataAccountDocument.stampIntegrity(kept);
  const idle={status:'idle',activeJob:null,hasActiveJob:false,controlSessionBound:false,requiresRebind:false,partialAvailable:false,continuable:false};
  window.__bridge={requests:[],status:idle,discover:null,push:(status)=>{window.__bridge.status=status;send('STATUS',crypto.randomUUID(),{status});}};
  window.addEventListener('message',(event)=>{
    const request=event.data;
    if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||request.bridgeSessionId!==session||['BRIDGE_READY','RESPONSE','STATUS','RESULT'].includes(request.type))return;
    window.__bridge.requests.push([request.type,request.payload??null]);
    const answers={LIST_ACCOUNTS:{ok:true,accounts:listed,selectedKey:listed.length?'rsi:keptcitizen':null,buildHistory:true},
      GET_ACCOUNT_BUILD:request.payload?.accountKey==='rsi:keptcitizen'?{ok:true,accountKey:'rsi:keptcitizen',result:build}:{ok:false,code:'NO_BUILD_HELD'},
      SELECT_ACCOUNT:{ok:true,selectedKey:request.payload?.accountKey},DISCOVER_CURRENT_ACCOUNT:window.__bridge.discover,
      REMOVE_ACCOUNT:window.__bridge.removeAnswer??{ok:true,removedKey:request.payload?.accountKey,selectedKey:window.__bridge.removeSelects??null,accounts:[]},
      PROPOSE_BUILD:{ok:false,code:'SELECTED_ACCOUNT_MISMATCH',message:'The RSI account signed in now is not the account selected in the dashboard, so nothing was read.'}};
    send('RESPONSE',request.requestId,{status:window.__bridge.status,...(answers[request.type]??{ok:true})});
  });
  send('BRIDGE_READY',crypto.randomUUID(),{extensionVersion:'0.42.2',capabilities:{buildJson:true,accountCollection:true,accounts:true}});
  return true;
})()`);

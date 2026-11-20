import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";

export async function checkStatusPanelLifecycle() {
  await evaluate(`(()=>{
    const session=crypto.randomUUID();const nonce='s'.repeat(40);const origin=location.protocol==='file:'?'null':location.origin;
    const activeJob={jobId:'job-status-only',runId:'run-status-only',status:'running',mode:'baseline',sectionIndex:13,sectionCount:14,completedSections:13,currentSection:'organizations.memberships',requestCount:142,httpRequestCount:142,
      httpRequestsTotal:143,resolvedRequestTotalsForSections:14,requestsBySection:{'organizations.memberships':0},requestProgressBySection:{'organizations.memberships':{completed:0,total:1,totalKnown:true,subphase:null}},
      activityLog:[{kind:'section-started',section:'organizations.memberships',at:'2026-11-18T21:14:24.000Z'}],failure:null};
    window.__statusOnlyBridge={session,nonce,origin};
    window.__statusOnlyStatus={status:'running',activeJob,hasActiveJob:true,controlSessionBound:true,requiresRebind:false,partialAvailable:false,continuable:false};
    window.__emitStatusOnly=(status)=>{window.__statusOnlyStatus=status;window.dispatchEvent(new MessageEvent('message',
      {source:window,origin,data:{channel:'citizendata.dashboard.v1',protocolVersion:1,type:'STATUS',requestId:crypto.randomUUID(),bridgeSessionId:session,nonce,payload:{status}}}));};
    window.addEventListener('message',(event)=>{
      const request=event.data;
      if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||!['GET_STATUS','PROPOSE_BUILD'].includes(request.type))return;
      const payload=request.type==='PROPOSE_BUILD'
        ? {ok:false,code:'TEST_DECLINED',message:'Synthetic proposal declined.',status:window.__statusOnlyStatus}
        : {ok:true,status:window.__statusOnlyStatus};
      window.dispatchEvent(new MessageEvent('message',{source:window,origin,data:{channel:'citizendata.dashboard.v1',protocolVersion:1,type:'RESPONSE',requestId:request.requestId,bridgeSessionId:session,nonce,payload}}));
    });
    window.dispatchEvent(new MessageEvent('message',
      {source:window,origin,data:{channel:'citizendata.dashboard.v1',protocolVersion:1,type:'BRIDGE_READY',requestId:crypto.randomUUID(),bridgeSessionId:session,nonce,payload:{extensionVersion:'0.42.1',capabilities:{buildJson:true}}}}));
    window.__emitStatusOnly(window.__statusOnlyStatus);return true;
  })()`);
  await waitFor("document.querySelector('#overlaySummary').textContent==='COLLECTING' && !document.querySelector('#collectionActivityImage').hidden");
  await evaluate("(()=>new Promise(resolve=>{const image=document.querySelector('#collectionActivityImage');window.__statusOnlySrcMutations=0;new MutationObserver(records=>{window.__statusOnlySrcMutations+=records.length}).observe(image,{attributes:true,"
    + "attributeFilter:['src']});window.__emitStatusOnly(structuredClone(window.__statusOnlyStatus));setTimeout(()=>resolve(true),0)}))()");
  assert(await evaluate("window.__statusOnlySrcMutations===0 && document.querySelector('#collectionActivityImage').getAttribute('src')==='assets/activity/dancing-ben.gif'"), "Routine log rendering restarted the active collection GIF.");
  await evaluate("if(!document.querySelector('#parserOverlay').classList.contains('minimized'))document.querySelector('#minimizeOverlay').click();window.__emitStatusOnly(structuredClone(window.__statusOnlyStatus))");
  assert(await evaluate("document.querySelector('#parserOverlay').classList.contains('minimized') && !document.querySelector('#closeOverlay').hidden"), "A status update overrode the user's minimized panel state.");
  await evaluate("(()=>{const complete=structuredClone(window.__statusOnlyStatus);complete.status='complete';complete.hasActiveJob=false;complete.activeJob.status='complete';complete.activeJob.sectionIndex=14;complete.activeJob.completedSections=14;"
    + "complete.activeJob.currentSection=null;window.__emitStatusOnly(complete);return true})()");
  await waitFor("document.querySelector('#overlaySummary').textContent==='COMPLETED'");
  assert(
    await evaluate("document.querySelector('#minimizeOverlay') && document.querySelector('#closeOverlay') && document.querySelector('#minimizeOverlay')!==document.querySelector('#closeOverlay')"),
    "Extension status did not retain separate minimize and close controls."
  );
  await evaluate("document.querySelector('#closeOverlay').click()");
  assert(await evaluate("document.querySelector('#parserOverlay').hidden"), "Extension status close control did not hide the panel.");
  await evaluate("window.__emitStatusOnly(structuredClone(window.__statusOnlyStatus))");
  await quiet();
  assert(await evaluate("document.querySelector('#parserOverlay').hidden"), "A status update reopened the dismissed completed panel.");
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#parserOverlay').hidden && !document.querySelector('#buildChoices').hidden");
  await evaluate("document.querySelector('#buildAccountAction').click()");
  await waitFor("!document.querySelector('#parserOverlay').hidden && document.querySelector('#messageDialog').open");
  assert(await evaluate("!document.querySelector('#parserOverlay').hidden"), "Build chooser account action did not reopen the completed panel.");
  await evaluate("document.querySelector('#messageDialog').close()");
}

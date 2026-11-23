import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

await evaluate(`(()=>{
  const session=crypto.randomUUID();const nonce='a'.repeat(40);const origin=location.protocol==='file:'?'null':location.origin;
  const activeJob={jobId:'job-status',runId:'run-status',status:'running',mode:'baseline',sectionIndex:8,sectionCount:13,completedSections:8,currentSection:'buybacks',requestCount:254,httpRequestCount:505,httpRequestsTotal:null,
    resolvedRequestTotalsForSections:9,requestsBySection:{buybacks:1},requestProgressBySection:{buybacks:{completed:1,total:16,totalKnown:true,subphase:null}},
    activityLog:[{kind:'section-started',section:'buybacks',at:'2026-11-18T15:00:00.000Z'},{kind:'request-started',method:'POST',route:'/api/account/buybackPledges',page:1,pageCount:null,at:'2026-11-18T15:00:00.100Z'},
    {kind:'request-completed',method:'POST',route:'/api/account/buybackPledges',page:1,pageCount:16,responseStatus:200,recordsReceived:100,elapsedMs:741,at:'2026-11-18T15:00:00.741Z'}],failure:null};
  window.__citizendataTestBridge={session,nonce,origin};
  window.__citizendataActiveStatus={status:'running',activeJob,hasActiveJob:true,controlSessionBound:true,requiresRebind:false,partialAvailable:false,continuable:false};
  window.__citizendataTestStatus=structuredClone(window.__citizendataActiveStatus);
  window.__emitCitizenDataStatus=(status)=>{window.__citizendataTestStatus=status;window.dispatchEvent(new MessageEvent('message',
    {source:window,origin,data:{channel:'citizendata.dashboard.v1',protocolVersion:2,type:'STATUS',requestId:crypto.randomUUID(),bridgeSessionId:session,nonce,payload:{status}}}));};
  window.addEventListener('message',async(event)=>{
    const request=event.data;
    if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||!['GET_STATUS','GET_PARTIAL_RESULT','PROPOSE_BUILD'].includes(request.type))return;
    let payload={ok:true,status:window.__citizendataTestStatus};
    if(request.type==='GET_PARTIAL_RESULT'){
      const partial=structuredClone(window.CITIZENDATA_DEMO_DATA);partial.account.handle='PartialCitizen';partial.profile.handle='PartialCitizen';partial.profile.displayName='Partial Citizen';
      payload={...payload,partialResult:await window.CitizenDataAccountDocument.stampIntegrity(partial)};
    }
    if(request.type==='PROPOSE_BUILD') payload={ok:false,code:'TEST_DECLINED',message:'Synthetic proposal declined.',status:window.__citizendataTestStatus};
    window.dispatchEvent(new MessageEvent('message',{source:window,origin,data:{channel:'citizendata.dashboard.v1',protocolVersion:2,type:'RESPONSE',requestId:request.requestId,bridgeSessionId:session,nonce,payload}}));
  });
  window.dispatchEvent(new MessageEvent('message',
    {source:window,origin,data:{channel:'citizendata.dashboard.v1',protocolVersion:2,type:'BRIDGE_READY',requestId:crypto.randomUUID(),bridgeSessionId:session,nonce,payload:{extensionVersion:'0.42.2',capabilities:{buildJson:true}}}}));
  window.__emitCitizenDataStatus(window.__citizendataTestStatus);return true;
})()`);
await waitFor("!document.querySelector('#collectionActivity').hidden");
assert(await evaluate("(()=>{const image=document.querySelector('#collectionActivityImage');return document.querySelector('#overlaySummary').textContent==='COLLECTING'&&document.querySelector('#overlayState').textContent==='Reading Buy Back "
  + "Pledges'&&!image.hidden&&image.getAttribute('src')==='assets/activity/dancing-ben.gif'&&document.querySelector('#collectionActivity').classList.contains('has-activity-image')&&Math.abs(document.querySelector('#collectionActivityProgress')"
  + ".value-(8/13*100))<0.01&&!document.querySelector('#requestProgress').hidden&&document.querySelector('#collectionRequestProgress').value===6.25&&document.querySelector('#collectionActivityText').textContent.includes('8 of 13 sections completed · "
  + "505 RSI requests completed')&&!document.querySelector('#eventLog').textContent.includes('No account collection has started.')&&document.querySelector('#eventLog').textContent.includes('POST /api/account/buybackPledges')})()"), "Active collection "
  + "did not render the exact section, progress, request, activity, and animation state.");
await evaluate("(()=>new Promise(resolve=>{const image=document.querySelector('#collectionActivityImage');window.__activitySrcMutations=0;new MutationObserver(records=>{window.__activitySrcMutations+=records.length}).observe(image,{attributes:true,"
  + "attributeFilter:['src']});window.__emitCitizenDataStatus(structuredClone(window.__citizendataActiveStatus));requestAnimationFrame(()=>resolve(true));}))()");
assert(
  await evaluate("window.__activitySrcMutations===0 && document.querySelector('#collectionActivityImage').getAttribute('src')==='assets/activity/dancing-ben.gif'"),
  "A routine status or log render reassigned the active GIF source and restarted its animation."
);
await evaluate("(()=>{const discovering=structuredClone(window.__citizendataActiveStatus);discovering.activeJob.requestProgressBySection.buybacks={completed:0,total:null,totalKnown:false,subphase:null};"
  + "discovering.activeJob.resolvedRequestTotalsForSections=8;discovering.activeJob.activityLog.push({kind:'request-started',method:'POST',route:'/api/account/buybackPledges',page:2,pageCount:null,at:'2026-11-18T15:00:01.000Z'});"
  + "window.__emitCitizenDataStatus(discovering);return true})()");
assert(await evaluate("!document.querySelector('#requestProgress').hidden && !document.querySelector('#collectionRequestProgress').hasAttribute('value') && document.querySelector('#requestProgressText').textContent==='Discovering request total...' && "
  + "document.querySelector('#eventLog').textContent.includes('Requesting POST /api/account/buybackPledges · page 2.') && document.querySelector('#collectionActivityText').textContent.includes('8 of 13 sections completed · 505 RSI requests completed') "
  + "&& !document.querySelector('#collectionActivityText').textContent.includes('totals known')"), "Unknown request totals were guessed, the immediate request-started activity was not rendered, or internal denominator coverage leaked into owner-facing "
  + "prose.");
await evaluate("window.__emitCitizenDataStatus(structuredClone(window.__citizendataActiveStatus))");
await evaluate("(()=>{const paused=structuredClone(window.__citizendataActiveStatus);paused.status='paused';paused.activeJob.status='paused';window.__emitCitizenDataStatus(paused);return true})()");
assert(await evaluate("!document.querySelector('#collectionActivity').hidden && document.querySelector('#overlaySummary').textContent==='PAUSED' && !document.querySelector('#collectionActivityImage').hasAttribute('src') && "
  + "!document.querySelector('#resumeCollection').hidden && document.querySelector('#resumeCollection').textContent==='Resume'"), "Paused collection did not remain visible without the activity GIF and Resume control.");
await evaluate("(()=>{const failed=structuredClone(window.__citizendataActiveStatus);failed.status='failed';failed.hasActiveJob=false;failed.partialAvailable=true;failed.continuable=true;failed.activeJob.status='failed';"
  + "failed.activeJob.failure={code:'RSI_READ_FAILED',message:'RSI_BUYBACKS_PAGE_MISMATCH_REQUESTED_2_OBSERVED_1'};window.__emitCitizenDataStatus(failed);return true})()");
await waitFor("document.querySelector('#accountHandle').textContent==='PartialCitizen' && document.querySelector('#statusToast').textContent.includes('Partial backup open')");
await evaluate("document.querySelector('#buildButton').click()");
await waitFor("!document.querySelector('#parserOverlay').hidden && !document.querySelector('#parserOverlay').classList.contains('minimized')");

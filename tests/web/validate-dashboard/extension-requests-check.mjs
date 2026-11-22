import { assert, extensionMessage, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkRefusedResultAndRosterRequests, checkSkipReconnectAndContinueRequests } from "./extension-skip-reconnect-continue-and-roster-requests-check.mjs";

async function checkImageQuestionAndWaitingFileOffer() {
  await reloadDashboard();
  await loadFixture('extension-requests-fixture.json', "documentCopy.account.handle='ControlCitizen';documentCopy.profile.handle='ControlCitizen';");
  await evaluate(`(()=>{
    const session=crypto.randomUUID(),nonce='c'.repeat(40);
    const send=(type,requestId,payload)=>${extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:2,type,requestId,bridgeSessionId:session,nonce,payload}")};
    const job=(status)=>({jobId:'job-controls',runId:'run-controls',status,mode:'baseline',sectionIndex:3,sectionCount:14,completedSections:3,currentSection:'buybacks',requestCount:10,httpRequestCount:10,httpRequestsTotal:null,
      resolvedRequestTotalsForSections:3,requestsBySection:{},requestProgressBySection:{},activityLog:[],failure:null});
    const shape=(status,extra={})=>({status,activeJob:status==='idle'?null:job(status),hasActiveJob:['running','paused'].includes(status),controlSessionBound:true,requiresRebind:false,partialAvailable:false,continuable:false,...extra});
    const after={PAUSE:()=>shape('paused'),RESUME:()=>shape('running'),CANCEL:()=>shape('cancelled'),REQUEST_REBIND:()=>shape('paused')};
    window.__controls={requests:[],keptImageReads:[],handOvers:[],status:shape('running'),shape,emit:(status)=>{window.__controls.status=status;send('STATUS',crypto.randomUUID(),{status});},deliver:(payload)=>send('RESULT',crypto.randomUUID(),payload)};
    window.addEventListener('message',(event)=>{
      const request=event.data;
      if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||request.bridgeSessionId!==session||['BRIDGE_READY','RESPONSE','STATUS','RESULT'].includes(request.type))return;
      // The two reads, the status and what images the extension keeps, are not run controls. Neither is the offer
      // of the file that was opened before the extension connected.
      if(request.type==='GET_KEPT_IMAGES')window.__controls.keptImageReads.push(request.payload??null);
      else if(request.type==='KEEP_BUILD')window.__controls.handOvers.push({keys:Object.keys(request.payload??{}),handle:request.payload?.document?.account?.handle??null});
      else if(request.type!=='GET_STATUS')window.__controls.requests.push({type:request.type,payload:request.payload??null});
      let payload={ok:true,status:window.__controls.status};
      if(after[request.type]){window.__controls.status=after[request.type]();payload={ok:true,status:window.__controls.status};}
      if(['CONTINUE_PARTIAL','PROPOSE_ORGANIZATION_ROSTER','PROPOSE_BUILD'].includes(request.type))payload={ok:false,code:'TEST_DECLINED',message:'The stand-in declined.',status:window.__controls.status};
      send('RESPONSE',request.requestId,payload);
    });
    send('BRIDGE_READY',crypto.randomUUID(),{extensionVersion:'0.42.1',capabilities:{buildJson:true}});
    window.__controls.emit(window.__controls.status);
    return true;
  })()`);
  const controls = "(()=>{const shown=(id)=>!document.getElementById(id).hidden&&!document.getElementById('collectionControls').hidden;return {rebind:shown('rebindCollection'),pause:shown('pauseCollection'),resume:shown('resumeCollection'),"
    + "cancel:shown('cancelCollection'),resumeText:document.getElementById('resumeCollection').textContent,rebindText:document.getElementById('rebindCollection').textContent,summary:document.getElementById('overlaySummary').textContent,"
    + "requests:window.__controls.requests.map(request=>request.type)}})()";
  const sent = (type) => `window.__controls.requests.filter(request=>request.type===${JSON.stringify(type)}).length`;
  await waitFor("document.getElementById('overlaySummary').textContent==='COLLECTING' && !document.getElementById('pauseCollection').hidden");
  const running = await evaluate(controls);
  assert(running.pause && running.cancel && !running.resume && !running.rebind && running.requests.length === 0, `A running job did not offer Pause and Cancel alone: ${JSON.stringify(running)}`);
  // With an account file open, the dashboard asks the extension once which images it keeps, and sends nothing with
  // the question. This stand-in keeps none, so the image card stays as it is without the extension.
  await waitFor("window.__controls.keptImageReads.length>=1");
  const keptReads = await evaluate("({reads:window.__controls.keptImageReads,imageFile:document.getElementById('imageFileStatus').textContent})");
  assert(keptReads.reads.length === 1 && keptReads.reads[0] === null && keptReads.imageFile === "No Images ZIP loaded", `The question about kept images was not one bare request, or it changed the image card: ${JSON.stringify(keptReads)}`);
  // The file opened before the extension connected was offered to it once, as the document alone.
  const handOvers = await evaluate("window.__controls.handOvers");
  assert(JSON.stringify(handOvers) === JSON.stringify([{ keys: ["document"], handle: "ControlCitizen" }]), `The opened file was not offered to the extension once: ${JSON.stringify(handOvers)}`);
  await evaluate("document.getElementById('pauseCollection').click()");
  await waitFor(`${sent("PAUSE")}===1 && document.getElementById('overlaySummary').textContent==='PAUSED'`);
  const paused = await evaluate(controls);
  assert(paused.resume && paused.resumeText === "Resume" && paused.cancel && !paused.pause, `A paused job did not offer Resume and Cancel: ${JSON.stringify(paused)}`);
  await evaluate("document.getElementById('resumeCollection').click()");
  await waitFor(`${sent("RESUME")}===1 && document.getElementById('overlaySummary').textContent==='COLLECTING'`);
  return { controls, sent };
}

// Each run control sends exactly one request of its own kind, a result is opened only after it passes the schema and
// integrity checks, and organization rosters are asked for by organization identifier and nothing else. A stand-in
// for the extension's bridge records what the page sends.
export async function checkExtensionRequests() {
  const shared = {};
  Object.assign(shared, await checkImageQuestionAndWaitingFileOffer());
  await checkSkipReconnectAndContinueRequests(shared);
  return checkRefusedResultAndRosterRequests(shared);
}

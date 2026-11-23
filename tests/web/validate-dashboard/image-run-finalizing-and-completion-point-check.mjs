import { assert, extensionMessage, openBuildChooser, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { PANEL, installRefusingHost, withImages } from "./imagerefusalwaitrun.mjs";

// The automatic download of the Images ZIP is an image run's completion point. Before it the run is FINALIZING while
// its images go to the extension, and Cancel then ends the run with no ZIP, the batch in flight counted and no batch
// after it. After it nothing awaits: the run is COMPLETED and no Cancel is shown, and a click on it changes nothing.
// A stand-in for the extension keeps images four to a request, and holds each request while `window.__keep.hold`.
const connectKeepingBridge = () => evaluate(`(()=>{
  const session=crypto.randomUUID(),nonce='k'.repeat(40);
  const send=(type,requestId,payload)=>${extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:2,type,requestId,bridgeSessionId:session,nonce,payload}")};
  const idle={status:'idle',activeJob:null,hasActiveJob:false,controlSessionBound:false,requiresRebind:false,partialAvailable:false,continuable:false};
  window.__keep={hold:false,batches:[],release:null};
  const answer=(request)=>{
    if(request.type==='GET_STATUS')return {ok:true,status:idle};
    if(request.type==='GET_KEPT_IMAGES')return {ok:true,keeping:true,limits:{filesPerRequest:4},images:[]};
    if(request.type==='KEEP_IMAGES')return {ok:true,stored:request.payload.files.map(file=>file.assetId),refused:[]};
    return {ok:false,code:'BUILD_HISTORY_OFF',message:'Build history is off.',status:idle};
  };
  window.addEventListener('message',(event)=>{
    const request=event.data;
    if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||request.bridgeSessionId!==session||['BRIDGE_READY','RESPONSE','STATUS','RESULT'].includes(request.type))return;
    if(request.type!=='KEEP_IMAGES')return send('RESPONSE',request.requestId,answer(request));
    window.__keep.batches.push({files:request.payload.files.length,downloads:window.__wait.downloads,badge:document.getElementById('overlaySummary').textContent});
    if(!window.__keep.hold)return send('RESPONSE',request.requestId,answer(request));
    window.__keep.release=()=>send('RESPONSE',request.requestId,answer(request));
  });
  send('BRIDGE_READY',crypto.randomUUID(),{extensionVersion:'0.42.2',capabilities:{buildJson:true}});
  return true;
})()`);
const CANCEL_SHOWN = "(()=>{const cancel=document.getElementById('mediaCancelOverlay');return !cancel.hidden&&cancel.getClientRects().length>0;})()";

async function startKeepingRun(name, hold) {
  await reloadDashboard();
  await loadFixture(name, withImages);
  await waitFor("/^[0-9]+ unique images$/u.test(document.getElementById('mediaSummary').textContent)");
  const planned = await evaluate("Number(document.getElementById('mediaSummary').textContent.split(' ')[0])");
  assert(planned > 4, `The image plan has ${planned} images, too few for more than one batch.`);
  await connectKeepingBridge();
  await installRefusingHost(planned);
  await evaluate(`window.__keep.hold=${hold}`);
  await openBuildChooser();
  await evaluate("document.getElementById('buildImagesAction').click()");
  return planned;
}

async function cancelWhileImagesAreHandedOver() {
  await startKeepingRun("finalizing-cancelled.json", true);
  await waitFor("window.__keep.batches.length===1&&typeof window.__keep.release==='function'", 30000);
  const finalizing = await evaluate(`({...${PANEL},shown:${CANCEL_SHOWN}})`);
  assert(finalizing.summary === "FINALIZING" && finalizing.operation === "Keeping images in the extension" && finalizing.shown && finalizing.downloads === 0 && !finalizing.save
    && finalizing.log.includes("Handing the images to the extension."), `The hand-over to the extension was not shown as FINALIZING before the download: ${JSON.stringify(finalizing)}`);
  const clicked = await evaluate(`(()=>{document.getElementById('mediaCancelOverlay').click();return ${PANEL};})()`);
  assert(clicked.summary === "CANCELLING", `Cancel during FINALIZING did not show CANCELLING: ${JSON.stringify(clicked)}`);
  await evaluate("window.__keep.release()");
  await waitFor("document.getElementById('overlaySummary').textContent==='CANCELLED'", 5000);
  const ended = await evaluate(`({...${PANEL},batches:window.__keep.batches.length})`);
  assert(ended.batches === 1 && ended.downloads === 0 && !ended.save
    && ended.status === "Image download cancelled. No partial ZIP was created. The extension keeps the 4 images it took before the cancel.",
    `Cancel during the hand-over sent more, or left a ZIP or a download: ${JSON.stringify(ended)}`);
  await evaluate("document.getElementById('closeOverlay').click()");
}

async function completedAtTheDownload() {
  const planned = await startKeepingRun("finalizing-completed.json", false);
  await waitFor("document.getElementById('overlaySummary').textContent==='COMPLETED'", 30000);
  const done = await evaluate(`({...${PANEL},shown:${CANCEL_SHOWN},batches:window.__keep.batches})`);
  assert(done.downloads === 1 && !done.shown && done.batches.length === Math.ceil(planned / 4) && done.batches.every((batch) => batch.downloads === 0 && batch.badge === "FINALIZING")
    && done.status.includes(`${planned} images are now kept in the extension.`), `The images were not all handed over before the download, or Cancel outlived it: ${JSON.stringify(done)}`);
  const after = await evaluate(`(()=>{document.getElementById('mediaCancelOverlay').click();return ${PANEL};})()`);
  assert(after.summary === "COMPLETED" && after.downloads === 1 && JSON.stringify(after.log) === JSON.stringify(done.log), `A click on Cancel after the download changed the run: ${JSON.stringify(after)}`);
  await evaluate("document.getElementById('closeOverlay').click()");
}

export async function checkImageRunFinalizingAndCompletionPoint() {
  await cancelWhileImagesAreHandedOver();
  await completedAtTheDownload();
}

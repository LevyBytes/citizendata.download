import { assert, extensionMessage, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";

// While the extension's build history is on, a page that has just loaded asks once for the latest build and opens
// what it is handed, in place of the example, without saving it again. A refusal leaves the example. A file the
// user opened first is not replaced, and is not even asked about. A stand-in for the bridge answers.
export async function checkLatestBuildOnLoad() {
  const connect = (answer) => evaluate(`(async()=>{
    const session=crypto.randomUUID(),nonce='l'.repeat(40);
    const send=(type,requestId,payload)=>${extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:2,type,requestId,bridgeSessionId:session,nonce,payload}")};
    const kept=structuredClone(window.CITIZENDATA_DEMO_DATA);kept.account.handle='KeptCitizen';kept.profile.handle='KeptCitizen';
    const stamped=await window.CitizenDataAccountDocument.stampIntegrity(kept);
    window.__latest={asked:0,payloads:[],downloads:[]};
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download)window.__latest.downloads.push(this.download);else click.call(this);};
    const status={status:'idle',activeJob:null,hasActiveJob:false,controlSessionBound:false,requiresRebind:false,partialAvailable:false,continuable:false};
    window.addEventListener('message',(event)=>{
      const request=event.data;
      if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||request.bridgeSessionId!==session||['BRIDGE_READY','RESPONSE','STATUS','RESULT'].includes(request.type))return;
      let payload={ok:true,status};
      if(request.type==='GET_LATEST_BUILD'){window.__latest.asked+=1;window.__latest.payloads.push(request.payload??null);payload=${answer};}
      send('RESPONSE',request.requestId,payload);
    });
    send('BRIDGE_READY',crypto.randomUUID(),{extensionVersion:'0.42.2',capabilities:{buildJson:true}});
    return true;
  })()`);
  const shown = "({handle:document.getElementById('accountHandle').textContent,eyebrow:document.getElementById('snapshotEyebrow').textContent,file:document.getElementById('railExported').textContent,toast:document.getElementById('statusToast')"
    + ".hidden?null:document.getElementById('statusToast').textContent,dialog:document.getElementById('messageDialog').open,asked:window.__latest.asked,payloads:window.__latest.payloads,downloads:window.__latest.downloads})";

  await reloadDashboard();
  const example = await evaluate("document.getElementById('accountHandle').textContent");
  await connect("{ok:true,result:stamped}");
  await waitFor("document.getElementById('accountHandle').textContent==='KeptCitizen'");
  const opened = await evaluate(shown);
  assert(await evaluate("document.getElementById('parserOverlay').hidden"), "The Build Status panel showed by itself on a page with nothing running.");
  assert(opened.asked === 1 && opened.payloads[0] === null && opened.eyebrow === "LOADED ACCOUNT SNAPSHOT" && /^citizendata-KeptCitizen-.+\.json$/u.test(opened.file) && opened.toast === "Your latest build, kept in the extension, is open."
    && !opened.dialog && opened.downloads.length === 0, `The latest build was not opened on load, or it was saved again: ${JSON.stringify(opened)}`);

  // Build history off: the extension hands over nothing, and the example stays.
  await reloadDashboard();
  await connect("{ok:false,code:'BUILD_HISTORY_OFF',message:'Build history is off, so the extension hands over no build by itself.'}");
  await waitFor("window.__latest.asked===1");
  await quiet();
  const refused = await evaluate(shown);
  assert(refused.handle === example && refused.eyebrow === "EXAMPLE ACCOUNT" && refused.toast === null && !refused.dialog && refused.asked === 1, `A page that was handed no build did not keep the example: ${JSON.stringify(refused)}`);

  // A file the user opened before the extension connected stays open, and the extension is not asked.
  await reloadDashboard();
  await loadFixture('opened-before-the-extension-fixture.json', "documentCopy.account.handle='FileCitizen';documentCopy.profile.handle='FileCitizen';");
  await connect("{ok:true,result:stamped}");
  await quiet();
  const kept = await evaluate(shown);
  assert(kept.handle === "FileCitizen" && kept.asked === 0, `A build from the extension replaced a file the user had opened: ${JSON.stringify(kept)}`);
}

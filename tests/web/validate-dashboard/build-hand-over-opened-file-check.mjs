import { assert, extensionMessage, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

export async function checkOpenedFileIsHandedOverAndAnswersAreTold() {
  const base = "Your file passed the canonical schema and SHA-256 integrity checks. It is open on this device; nothing was uploaded or saved by the website.";
  const connect = (answer, latest = "{ok:false,code:'NO_BUILD',message:'The extension holds no finished build.'}", organizationsAnswer = "{ok:true,kept:true,rosters:1}") => evaluate(`(async()=>{
    const session=crypto.randomUUID(),nonce='k'.repeat(40);
    const send=(type,requestId,payload)=>${extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:1,type,requestId,bridgeSessionId:session,nonce,payload}")};
    const kept=structuredClone(window.CITIZENDATA_DEMO_DATA);kept.account.handle='KeptCitizen';kept.profile.handle='KeptCitizen';
    const stamped=await window.CitizenDataAccountDocument.stampIntegrity(kept);
    window.__keep={asked:0,payloads:[],order:[],organizations:[]};
    const status={status:'idle',activeJob:null,hasActiveJob:false,controlSessionBound:false,requiresRebind:false,partialAvailable:false,continuable:false};
    window.addEventListener('message',(event)=>{
      const request=event.data;
      if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||request.bridgeSessionId!==session||['BRIDGE_READY','RESPONSE','STATUS','RESULT'].includes(request.type))return;
      let payload={ok:true,status};
      if(request.type==='GET_LATEST_BUILD')payload=${latest};
      if(request.type==='KEEP_BUILD'){const handed=request.payload?.document;window.__keep.asked+=1;window.__keep.order.push(request.type);window.__keep.payloads.push({keys:Object.keys(request.payload??{}),handle:handed?.account?.handle??null,
        hash:handed?.integrity?.contentHash??null,members:Array.isArray(handed?.organizations?.members)?handed.organizations.members.length:null});payload=${answer};}
      if(request.type==='KEEP_ORGANIZATIONS'){const handed=request.payload?.document;window.__keep.order.push(request.type);window.__keep.organizations.push({keys:Object.keys(request.payload??{}),type:handed?.documentType??null,
        handle:handed?.account?.handle??null,hash:handed?.integrity?.contentHash??null});payload=${organizationsAnswer};}
      send('RESPONSE',request.requestId,payload);
    });
    send('BRIDGE_READY',crypto.randomUUID(),{extensionVersion:'0.42.1',capabilities:{buildJson:true}});
    return true;
  })()`);
  const openFile = async (fileName) => {
    await evaluate(`(async () => {
      const copy = structuredClone(window.CITIZENDATA_DEMO_DATA);
      copy.account.handle = 'FileCitizen'; copy.profile.handle = 'FileCitizen';
      const stamped = await window.CitizenDataAccountDocument.stampIntegrity(copy);
      window.__keepFile = { hash: stamped.integrity.contentHash, members: Array.isArray(stamped.organizations?.members) ? stamped.organizations.members.length : null };
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(stamped)], ${JSON.stringify(fileName)}, { type: 'application/json' }));
      const input = document.querySelector('#jsonFileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    // The file is confirmed at once, and the extension's answer is added to the same message when it arrives.
    await waitFor("document.querySelector('#messageDialog').open");
    if (await evaluate("Boolean(window.__keep)")) await waitFor(`window.__keep.asked===1 && document.getElementById('dialogMessage').textContent!==${JSON.stringify(base)}`);
    const shown = await evaluate("({title:document.getElementById('dialogTitle').textContent,message:document.getElementById('dialogMessage').textContent,handle:document.getElementById('accountHandle').textContent,asked:window.__keep?.asked??0,"
      + "payloads:window.__keep?.payloads??[],file:window.__keepFile})");
    await evaluate("document.querySelector('#messageDialog').close()");
    return shown;
  };

  // Kept: one request, the document alone, and it is the file as it was opened, rosters included.
  await reloadDashboard();
  await connect("{ok:true,kept:true,replaced:false}");
  const kept = await openFile('handed-over-fixture.json');
  assert(
    kept.title === "Account file verified" && kept.message === `${base} The extension now keeps this file as your latest build.` && kept.handle === "FileCitizen" && kept.asked === 1,
    `An opened account file was not handed to the extension: ${JSON.stringify(kept)}`
  );
  assert(
    JSON.stringify(kept.payloads[0]) === JSON.stringify({ keys: ["document"], handle: "FileCitizen", hash: kept.file.hash, members: kept.file.members }),
    `The extension was not handed the file as it was opened: ${JSON.stringify(kept.payloads)} for ${JSON.stringify(kept.file)}`
  );

  // Each answer of the extension is told in the dialog.
  const answers = [
    ["{ok:true,kept:true,replaced:true}", "The extension now keeps this file as your latest build, in place of the older build it held."],
    ["{ok:true,kept:false,reason:'SAME_BUILD'}", "The extension already keeps this build."],
    ["{ok:true,kept:false,reason:'NEWER_BUILD_HELD'}", "The extension keeps a newer build of this account, so it did not take this file in."],
    ["{ok:false,code:'BUILD_HISTORY_OFF',message:'x'}", "The extension did not take this file in, because Build history is off in the extension popup."],
    ["{ok:false,code:'BUILD_IN_PROGRESS',message:'x'}", "The extension did not take this file in, because a build is in progress. Open the file again when that build has finished."],
    ["{ok:false,code:'INCOMPLETE_BUILD',message:'x'}", "The extension did not take this file in, because it is not a complete build."],
    ["{ok:false,code:'INVALID_BUILD',message:'x'}", "The extension did not take this file in, because it did not pass the extension's own checks."],
    ["{ok:false,code:'UNTRUSTED_DASHBOARD',message:'x'}", "The extension did not take this file in."]
  ];
  for (const [answer, sentence] of answers) {
    await reloadDashboard();
    await connect(answer);
    const told = await openFile('handed-over-fixture.json');
    assert(told.message === `${base} ${sentence}` && told.asked === 1, `The answer ${answer} was not told: ${JSON.stringify(told.message)}`);
  }
  return { base, connect, openFile };
}

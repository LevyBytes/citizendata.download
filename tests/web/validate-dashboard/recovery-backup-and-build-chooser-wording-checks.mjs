import { assert, buildChooserState, extensionMessage, openBuildChooser, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";

// The extension's recovery backup is not an account file, but it holds one: Load JSON opens the newest finished build
// inside it after the usual checks, and says where the file is imported to put the extension's records back. One
// that holds no build is refused with the same direction, not with a list of schema errors.
export async function checkRecoveryBackupOpens() {
  const open = async (fileName, snapshots) => {
    await reloadDashboard();
    await evaluate(`(async () => {
      const build = async (handle,
        exportedAt) => { const copy = structuredClone(window.CITIZENDATA_DEMO_DATA); copy.account.handle = handle; copy.profile.handle = handle; copy.exportedAt = exportedAt; return window.CitizenDataAccountDocument.stampIntegrity(copy); };
      const snapshots = [];
      for (const [handle, exportedAt] of ${JSON.stringify(snapshots)}) snapshots.push({ accountId: handle, document: await build(handle, exportedAt), promotedAt: exportedAt, runId: crypto.randomUUID() });
      const backup = { databaseVersion: 4, exportedAt: '2026-11-19T18:00:00.000Z', stores: { runtime: [], proposals: [], authorizations: [], jobs: [], stagedRuns: [], snapshots, checkpoints: [], receipts: [], replaySessions: [], pages: [] } };
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(backup)], ${JSON.stringify(fileName)}, { type: 'application/json' }));
      const input = document.querySelector('#jsonFileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor("document.querySelector('#messageDialog').open");
    const result = await evaluate("({eyebrow:document.querySelector('#messageDialog .eyebrow')?.textContent??null,title:document.getElementById('dialogTitle').textContent,message:document.getElementById('dialogMessage').textContent,"
      + "handle:document.getElementById('accountHandle').textContent,snapshot:document.getElementById('snapshotEyebrow').textContent,file:document.getElementById('railExported').textContent})");
    await evaluate("document.querySelector('#messageDialog').close()");
    return result;
  };
  const direction = "To put the extension's records back, import this file in the extension popup under Recovery and permissions.";
  const one = await open('citizendata-recovery-one.json', [["RecoveredCitizen", "2026-11-19T17:57:08.305Z"]]);
  assert(one.title === "Latest build opened" && one.handle === "RecoveredCitizen" && one.snapshot === "LOADED ACCOUNT SNAPSHOT" && one.file === "citizendata-recovery-one.json" && one.message.startsWith("citizendata-recovery-one.json is an extension "
    + "recovery backup. The finished build inside it passed") && one.message.endsWith(direction), `A recovery backup was not opened as its build: ${JSON.stringify(one)}`);
  const two = await open('citizendata-recovery-two.json', [["OlderCitizen", "2026-11-18T10:00:00.000Z"], ["NewerCitizen", "2026-11-19T10:00:00.000Z"]]);
  assert(two.title === "Latest build opened" && two.handle === "NewerCitizen" && two.message.includes("The newest of the 2 finished builds inside it passed"), `A recovery backup with two builds did not open the newest: ${JSON.stringify(two)}`);
  const none = await open('citizendata-recovery-empty.json', []);
  assert(
    none.title === "File rejected" && none.message === `This is an extension recovery backup, and it holds no finished build to open. ${direction}` && none.snapshot === "EXAMPLE ACCOUNT",
    `A recovery backup without a build was not refused with a direction: ${JSON.stringify(none)}`
  );
}

// The line above the two build choices names only what can be chosen now, and says what the other choice needs.
// Without the extension and with the example open, nothing can be chosen, and the line does not ask for a choice.
export async function checkBuildChooserWording() {
  const connect = () => evaluate(`(()=>{
    const session=crypto.randomUUID(),nonce='w'.repeat(40);
    const send=(type,requestId,payload)=>${extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:2,type,requestId,bridgeSessionId:session,nonce,payload}")};
    const status={status:'idle',activeJob:null,hasActiveJob:false,controlSessionBound:false,requiresRebind:false,partialAvailable:false,continuable:false};
    window.addEventListener('message',(event)=>{
      const request=event.data;
      if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||request.bridgeSessionId!==session||['BRIDGE_READY','RESPONSE','STATUS','RESULT'].includes(request.type))return;
      send('RESPONSE',request.requestId,request.type==='GET_STATUS'?{ok:true,status}:{ok:false,code:'TEST_DECLINED',message:'The stand-in declined.'});
    });
    send('BRIDGE_READY',crypto.randomUUID(),{extensionVersion:'0.42.1',capabilities:{buildJson:true}});
    return true;
  })()`);
  const wording = async () => {
    await openBuildChooser();
    const shown = await evaluate(buildChooserState);
    const badge = await evaluate("document.getElementById('overlaySummary').textContent");
    await evaluate("document.getElementById('closeOverlay').click()");
    return { badge, title: shown.state, line: shown.line, data: shown.account && !shown.accountDisabled, images: !shown.imagesDisabled };
  };
  const same = (actual, expected, label) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: ${JSON.stringify(actual)}`);

  // No extension, the example: nothing can be chosen.
  await reloadDashboard();
  same(await wording(), { badge: "READY", title: "Before you can build", line: "Data needs the CitizenData extension. Images need an open account document.", data: false, images: false }, "No extension and the example");
  // No extension, an account file with images: only the images.
  await loadFixture('chooser-wording-fixture.json', "documentCopy.account.handle='ChooserCitizen';documentCopy.profile.handle='ChooserCitizen';");
  await waitFor("/^[0-9]+ unique images$/u.test(document.getElementById('mediaSummary').textContent)");
  same(await wording(), { badge: "READY", title: "Choose what to build", line: "Nothing starts until you choose Images. Data needs the CitizenData extension.", data: false, images: true }, "No extension and an account file");
  // The extension and an account file: both, in the wording as it was.
  await connect();
  await waitFor("!document.getElementById('buildButton').classList.contains('bridge-gated')");
  same(await wording(), { badge: "READY", title: "Choose what to build", line: "Nothing starts until you choose Data or Images.", data: true, images: true }, "The extension and an account file");
  // The extension and the example: only the data.
  await reloadDashboard();
  await connect();
  await quiet();
  same(await wording(), { badge: "READY", title: "Choose what to build", line: "Nothing starts until you choose Data. Images need an open account document.", data: true, images: false }, "The extension and the example");
}

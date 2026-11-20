import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { checkOpenedFileIsHandedOverAndAnswersAreTold } from "./build-hand-over-opened-file-check.mjs";
import { checkOrgsJsonHandOverAndHangarLinkNeverOffered } from "./build-hand-over-orgs-json-and-hangar-link-check.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";

async function checkWaitingFileOwnBuildAndRecoveryBackupHandOver({ base, connect, openFile }) {
  // No extension: the dialog is as it was. When the extension connects, the waiting file is handed over, once.
  await reloadDashboard();
  const alone = await openFile('opened-first-fixture.json');
  assert(alone.message === base && alone.asked === 0, `Without the extension the dialog changed: ${JSON.stringify(alone)}`);
  await quiet();
  assert(await evaluate("document.getElementById('statusToast').hidden"), "Without the extension a notice about it was shown.");
  await connect("{ok:true,kept:true,replaced:false}");
  await waitFor("window.__keep.asked===1 && !document.getElementById('statusToast').hidden");
  const later = await evaluate("({toast:document.getElementById('statusToast').textContent,asked:window.__keep.asked,handle:window.__keep.payloads[0].handle,shown:document.getElementById('accountHandle').textContent})");
  assert(
    later.toast === "The extension now keeps this file as your latest build." && later.asked === 1 && later.handle === "FileCitizen" && later.shown === "FileCitizen",
    `A file opened before the extension connected was not handed over: ${JSON.stringify(later)}`
  );

  // A build the extension handed to the page is not handed back.
  await reloadDashboard();
  await connect("{ok:true,kept:true,replaced:false}", "{ok:true,result:stamped}");
  await waitFor("document.getElementById('accountHandle').textContent==='KeptCitizen'");
  await quiet();
  assert(await evaluate("window.__keep.asked") === 0, "A build from the extension was handed back to it.");

  // The newest build inside a recovery backup is handed over in the same way, and the message then says where the
  // file's other records are put back.
  await reloadDashboard();
  await connect("{ok:true,kept:true,replaced:false}");
  await evaluate(`(async () => {
    const copy = structuredClone(window.CITIZENDATA_DEMO_DATA); copy.account.handle = 'RecoveredCitizen'; copy.profile.handle = 'RecoveredCitizen';
    const stamped = await window.CitizenDataAccountDocument.stampIntegrity(copy);
    const backup = { databaseVersion: 4, exportedAt: '2026-11-19T18:00:00.000Z',
      stores: { runtime: [], proposals: [], authorizations: [], jobs: [], stagedRuns: [], snapshots: [{ accountId: 'RecoveredCitizen', document: stamped, promotedAt: stamped.exportedAt, runId: crypto.randomUUID() }], checkpoints: [], receipts: [],
      replaySessions: [], pages: [] } };
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(backup)], 'citizendata-recovery-handed.json', { type: 'application/json' }));
    const input = document.querySelector('#jsonFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#messageDialog').open && window.__keep.asked===1 && document.getElementById('dialogMessage').textContent.includes('The extension ')");
  const recovered = await evaluate("({title:document.getElementById('dialogTitle').textContent,message:document.getElementById('dialogMessage').textContent,handle:window.__keep.payloads[0].handle,keys:window.__keep.payloads[0].keys})");
  await evaluate("document.querySelector('#messageDialog').close()");
  assert(recovered.title === "Latest build opened" && recovered.handle === "RecoveredCitizen" && recovered.keys.join() === "document" && recovered.message.endsWith("nothing was uploaded or saved by the website. The extension now keeps that build as your "
    + "latest build. The other records in this file are put back by importing it in the extension popup under Recovery and permissions."), `The build inside a recovery backup was not handed over: ${JSON.stringify(recovered)}`);
}

// A complete account file the user opened is handed to the extension by itself: once, as the whole file and nothing
// beside it, and the dialog says what the extension answered. A file opened before the extension connected is
// handed over when it connects. The example, a Hangar Link file, and a build the extension handed to the page are
// never offered. A stand-in for the bridge answers.
export async function checkBuildHandOver() {
  const shared = {};
  Object.assign(shared, await checkOpenedFileIsHandedOverAndAnswersAreTold());
  await checkWaitingFileOwnBuildAndRecoveryBackupHandOver(shared);
  return checkOrgsJsonHandOverAndHangarLinkNeverOffered(shared);
}

import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

export async function checkOrgsJsonHandOverAndHangarLinkNeverOffered({ connect, openFile }) {
  // An Orgs JSON opened after its account file is handed over too, after the build it belongs to, as the document
  // alone, and each answer is told.
  const openOrganizations = async () => {
    await evaluate(`(async () => {
      const copy = structuredClone(window.CITIZENDATA_DEMO_DATA);
      copy.account.handle = 'FileCitizen'; copy.profile.handle = 'FileCitizen';
      const organizations = await window.CitizenDataOrganizationDocument.fromAccountDocument({ accountDocument: copy });
      window.__keepOrganizationsHash = organizations.integrity.contentHash;
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(organizations)], 'handed-over-organizations.json', { type: 'application/json' }));
      const input = document.querySelector('#orgFileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor("document.querySelector('#messageDialog').open && document.getElementById('dialogTitle').textContent==='Organization data verified' && document.getElementById('dialogMessage').textContent.includes('The extension ')");
    const shown = await evaluate("({message:document.getElementById('dialogMessage').textContent,order:window.__keep.order,organizations:window.__keep.organizations,hash:window.__keepOrganizationsHash})");
    await evaluate("document.querySelector('#messageDialog').close()");
    return shown;
  };
  const verifiedOrganizations = "handed-over-organizations.json passed integrity and account identity checks. It is open on this device; nothing was uploaded.";
  const organizationAnswers = [
    ["{ok:true,kept:true,rosters:1}", "The extension now keeps these rosters with your latest build."],
    ["{ok:true,kept:false,reason:'NOTHING_NEWER'}", "The extension already keeps these rosters."],
    ["{ok:false,code:'NO_BUILD_HELD',message:'x'}", "The extension did not take these rosters in, because it holds no build of this account. Open the account JSON first."],
    ["{ok:false,code:'INVALID_ORGANIZATIONS',message:'x'}", "The extension did not take these rosters in, because they did not pass the extension's own checks."],
    ["{ok:false,code:'BUILD_HISTORY_OFF',message:'x'}", "The extension did not take these rosters in, because Build history is off in the extension popup."]
  ];
  for (const [answer, sentence] of organizationAnswers) {
    await reloadDashboard();
    await connect("{ok:true,kept:true,replaced:false}", undefined, answer);
    await openFile('handed-over-fixture.json');
    const rosters = await openOrganizations();
    assert(rosters.message === `${verifiedOrganizations} ${sentence}`, `The answer ${answer} about the rosters was not told: ${JSON.stringify(rosters.message)}`);
    assert(
      rosters.order.join() === "KEEP_BUILD,KEEP_ORGANIZATIONS" && JSON.stringify(rosters.organizations) === JSON.stringify([{ keys: ["document"], type: "CitizenDataOrganizations", handle: "FileCitizen", hash: rosters.hash }]),
      `The Orgs JSON was not handed over once, after its build: ${JSON.stringify(rosters.order)} ${JSON.stringify(rosters.organizations)}`
    );
  }

  // A Hangar Link file is an incomplete build and is never offered.
  await reloadDashboard();
  await connect("{ok:true,kept:true,replaced:false}");
  await evaluate(`(async () => {
    const source = structuredClone(window.CITIZENDATA_DEMO_DATA);
    source.pledges.forEach((record, index) => { record.pledgeId = 41000001 + index; record.sourcePage = 1; });
    source.buybacks.forEach((record, index) => { record.buybackId = 21000001 + index; record.sourcePage = 1; });
    const written = window.CitizenDataHangarLinkExport.prepareExport(source, {inventoryScope:'both'}).payload;
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(written)], 'hangarlink-not-offered.json', {type:'application/json'}));
    const input = document.querySelector('#jsonFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor("document.querySelector('#messageDialog').open");
  const imported = await evaluate("({title:document.getElementById('dialogTitle').textContent,asked:window.__keep.asked})");
  await evaluate("document.querySelector('#messageDialog').close()");
  assert(imported.title === "Incomplete build opened" && imported.asked === 0, `A Hangar Link file was offered to the extension: ${JSON.stringify(imported)}`);
}

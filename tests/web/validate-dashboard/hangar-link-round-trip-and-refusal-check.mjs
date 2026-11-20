import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { chooseExport, downloadExport } from "./export-dialog-and-download.mjs";

export async function checkHangarLinkRoundTripCreditCostAndRefusal() {
  // Written again for Hangar Link, the opened file gives back its own records, the repeated one once.
  await evaluate("document.querySelector('#exportButton').click()");
  await chooseExport({exportPreset:'inventory', exportInventoryScope:'both', exportFormat:'hangar-link'});
  const again = await downloadExport('citizendata-hangar-and-buybacks-hangar-link.json');
  const original = await evaluate("window.__hangarLinkFile");
  const lamp = again.pledges.find(record => record.name === 'Decorations - The Lamp');
  assert(again.pledges.length === 7 && lamp && lamp.cost === '0.0', `The opened Hangar Link file was not written again with seven records: ${again.pledges.length}`);
  // A cost in game credits is the one value the file cannot state, so it comes back in dollars with a cost of 0.
  const comparable = record => JSON.stringify({...record, currency:'USD'});
  assert(JSON.stringify(again.pledges.map(comparable)) === JSON.stringify(original.pledges.slice(0, 7).map(comparable)), 'The opened Hangar Link file changed when it was written again.');
  await chooseExport({exportInventoryScope:'both', exportFormat:'native'});
  await evaluate("document.querySelector('#exportClose').click()");

  // A Hangar Link file CitizenData cannot open as one account is refused, and the open document stays.
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify({type:'hangarlink', version:2, pledges:window.__hangarLinkFile.pledges})], 'hangarlink-newer.json', {type:'application/json'}));
    const input = document.querySelector('#jsonFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor("document.querySelector('#messageDialog').open");
  const refused = await evaluate("({detail:document.querySelector('#messageDialog p').textContent, exported:document.querySelector('#railExported').textContent})");
  assert(refused.detail.includes('This Hangar Link file is version 2. CitizenData reads version 1.') && refused.exported === 'hangarlink-example.json', `A newer Hangar Link file was not refused with its reason: ${JSON.stringify(refused)}`);
  await evaluate("document.querySelector('#messageDialog').close()");
}

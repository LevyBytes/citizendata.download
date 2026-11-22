import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement, loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { checkExportDialog, chooseExport, downloadExport } from "./export-dialog-and-download.mjs";
import { captureScreenshots } from "./run-options-and-work-folders.mjs";

// A loaded backup with RSI pledge numbers is written as the file Hangar Link and Fleetview import.
export async function checkHangarLinkExport() {
  await loadFixture('hangar-link-fixture.json', `
    documentCopy.pledges.forEach((record, index) => {
      record.pledgeId = 41000001 + index;
      record.meltValue = {amount: index === 1 ? '45.00' : '12.50', currency:'USD'};
      record.baseValue = {amount:'0.00', currency:'USD'};
      record.meltEligible = index !== 0;
      record.giftEligible = index === 1;
      record.sourcePage = index + 1;
      for (const item of record.items) {
        item.manufacturer = item.kind === 'Ship' ? 'Example Maker (EXMP)' : null;
        item.customName = item.name === 'F7C-M Hornet Heartseeker Mk I' ? 'Example Name' : null;
        item.section = item.name === 'Star Citizen Digital Download' ? 'alsoContains' : 'items';
      }
    });
    documentCopy.buybacks.forEach((record, index) => { record.buybackId = 21000001 + index; record.sourcePage = 1; });
  `);
  const fleet = await downloadExport('citizendata-hangar-hangar-link.json', '#fleetviewExportButton');
  assert(fleet.type === 'hangarlink' && fleet.version === 1 && fleet.pledges.length === 3, 'Export FleetView did not immediately write the three hangar pledges.');
  assert(fleet.pledges.every(record => record.buyback === false), 'Export FleetView included a buy-back record.');
  await evaluate("document.querySelector('#exportButton').click()");
  await chooseExport({exportPreset:'inventory', exportInventoryScope:'both', exportFormat:'hangar-link'});
  const offered = await evaluate("({summary:document.querySelector('#exportSummary').textContent, disabled:document.querySelector('#exportDownload').disabled, errors:document.querySelectorAll('#exportMessages .export-error').length, "
    + "warnings:[...document.querySelectorAll('#exportMessages .export-warning')].map(node=>node.textContent)})");
  assert(offered.summary === '7 records \u00b7 hangar-link-fixture.json' && !offered.disabled && offered.errors === 0, `Hangar Link export was not offered for a backup with pledge numbers: ${JSON.stringify(offered)}`);
  assert(
    offered.warnings.includes("This backup holds no buy-back prices, so buy-backs are written with a cost of 0. Build it again with the extension to record them."),
    `The export did not say that buy-back prices are missing: ${JSON.stringify(offered.warnings)}`
  );
  await checkExportDialog('Hangar Link export');
  if (captureScreenshots) await captureElement('#exportDialog', 'work-temp-export-hangar-link.png');
  const both = await downloadExport('citizendata-hangar-and-buybacks-hangar-link.json');
  assert(Object.keys(both).join() === 'type,version,pledges' && both.type === 'hangarlink' && both.version === 1 && both.pledges.length === 7, 'The downloaded file is not the Hangar Link envelope with seven records.');
  assert(both.pledges.every(record => Object.keys(record).length === 26 && record.hangar === 'DownloadCitizen'), 'A Hangar Link record lacks a field or the account handle.');
  const amd = both.pledges.find(record => record.name === 'Package - AMD Never Settle Space Edition');
  assert(
    amd && amd.pledgeId === '41000002' && amd.date === '2014-09-02' && amd.cost === '45.0' && amd.giftable === true && amd.meltable === true && amd.page === 2 && amd.pageOf === 10,
    `The package pledge was not written with its recorded values: ${JSON.stringify(amd)}`
  );
  assert(amd.insuranceType === 'ins2' && amd.package === true && amd.uec === '1000.0' && amd.pledgeType === 'ship', 'Insurance, package, starting UEC, or pledge type was not read from the pledge contents.');
  assert(
    amd.items.find(item => item.kind === 'Ship').slug === 'mustang-omega' && amd.alsoContains.length === 1 && amd.alsoContains[0].title === 'Star Citizen Digital Download',
    'The ship was not named by its Hangar Link slug, or the also-contains list was not kept apart.'
  );
  const weekend = both.pledges.find(record => record.name === 'Package - Weekend Warrior - LTI');
  const heartseeker = weekend.items.find(item => item.kind === 'Ship');
  assert(
    weekend.insuranceType === 'insLTI' && weekend.uec === '5000.0' && heartseeker.slug === 'f7c-m-super-hornet-heartseeker' && heartseeker.itemCustomName === 'Example Name' && heartseeker.liner === 'Example Maker (EXMP)',
    `The second package was not written correctly: ${JSON.stringify(weekend)}`
  );
  const combo = both.pledges.find(record => record.name === 'Standalone Ships - Argo Combo Pack - LTI');
  assert(
    combo && combo.buyback === true && combo.pledgeId === '21000004' && combo.buybackHref === '/pledge/buyback/21000004' && combo.date === '2016-08-25' && combo.pledgeType === 'ship' && combo.pageOf === 100 && combo.items.length === 0,
    `A buy-back was not written correctly: ${JSON.stringify(combo)}`
  );
  const eclipse = both.pledges.find(record => record.name === 'Standalone Ship - Aegis Eclipse LTI');
  assert(eclipse && eclipse.buyback === true && eclipse.pledgeId === '21000003' && eclipse.date === '2017-05-19' && eclipse.pledgeType === 'ship', `The Eclipse buy-back was not written with its date: ${JSON.stringify(eclipse)}`);
  for (const [scope, suffix, expected] of [['hangar', 'hangar', [false, false, false]], ['buybacks', 'buybacks', [true, true, true, true]]]) {
    await chooseExport({exportInventoryScope:scope});
    const file = await downloadExport(`citizendata-${suffix}-hangar-link.json`);
    assert(JSON.stringify(file.pledges.map(record => record.buyback)) === JSON.stringify(expected), `${scope}: the Hangar Link file holds records from the other list.`);
  }
  await chooseExport({exportInventoryScope:'both', exportFormat:'native'});
  await evaluate("document.querySelector('#exportClose').click()");
}

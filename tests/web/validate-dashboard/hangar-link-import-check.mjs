import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkHangarLinkRoundTripCreditCostAndRefusal } from "./hangar-link-round-trip-and-refusal-check.mjs";

async function checkHangarLinkFileOpens() {
  await reloadDashboard();
  await evaluate(`(async () => {
    const source = structuredClone(window.CITIZENDATA_DEMO_DATA);
    source.pledges.forEach((record, index) => { record.pledgeId = 41000001 + index; record.meltValue = {amount: index === 0 ? '2000.00' : '185.00', currency: index === 0 ? 'UEC' : 'USD'}; record.sourcePage = 1; });
    source.buybacks.forEach((record, index) => { record.buybackId = 21000001 + index; record.sourcePage = 1; record.buybackPrice = index === 0 ? {amount:'45.00', currency:'USD'} : null; });
    const written = window.CitizenDataHangarLinkExport.prepareExport(source, {inventoryScope:'both'}).payload;
    // Hangar Link's own files can hold a record twice.
    written.pledges.push(structuredClone(written.pledges.at(-1)));
    window.__hangarLinkFile = written;
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(written)], 'hangarlink-example.json', {type:'application/json'}));
    const input = document.querySelector('#jsonFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor("document.querySelector('#messageDialog').open");
  const opened = await evaluate(`({
    eyebrow:document.querySelector('#dialogEyebrow').textContent,
    heading:document.querySelector('#messageDialog h2').textContent,
    detail:document.querySelector('#messageDialog p').textContent,
    exported:document.querySelector('#railExported').textContent,
    handle:document.querySelector('#accountHandle').textContent,
    eyebrowTop:document.querySelector('#snapshotEyebrow').textContent,
    statusTitle:document.querySelector('#documentStatusTitle').textContent,
    source:document.querySelector('#healthSource').textContent,
    collection:document.querySelector('#healthCompleteness').textContent,
    summary:document.querySelector('#healthSummaryDetail').textContent,
    buildLabel:document.querySelector('#buildButtonLabel').textContent,
    buildDisabled:document.querySelector('#buildButton').disabled,
    storeCredit:document.querySelector('#storeCredit').textContent,
    billingTotal:document.querySelector('#billingTotal').textContent
  })`);
  assert(opened.eyebrow === 'HANGAR LINK JSON' && opened.heading === 'Incomplete build opened', `A Hangar Link file was not opened as an incomplete build: ${JSON.stringify(opened)}`);
  assert(opened.detail === 'hangarlink-example.json is open with 3 hangar pledges and 4 buy-backs. 1 record appears in the file more than once and is shown once. A Hangar Link file holds no Hangar Log, billing, referrals, organizations, or images. Choose '
    + 'Build to read the whole account from RSI with the extension. Nothing was uploaded or saved by the website.', `The message for an opened Hangar Link file is wrong: ${opened.detail}`);
  assert(opened.exported === 'hangarlink-example.json' && opened.handle === 'DownloadCitizen', `The opened Hangar Link file is not named, or its account is not shown: ${JSON.stringify(opened)}`);
  assert(
    opened.source === 'Hangar Link JSON opened in this browser' && opened.collection === 'Incomplete build \u00b7 0 of 16 sections complete' && opened.summary.startsWith('Incomplete build \u00b7 0 of 16 sections complete'),
    `File status does not say the build is incomplete: ${JSON.stringify(opened)}`
  );
  assert(opened.eyebrowTop === 'INCOMPLETE BUILD · HANGAR LINK JSON' && opened.statusTitle === 'HANGAR LINK JSON LOADED', `The top of the page does not say an incomplete build is open: ${JSON.stringify(opened)}`);
  assert(opened.buildLabel === 'Build' && !opened.buildDisabled, 'Build is not offered for an opened Hangar Link file.');
  assert(!opened.storeCredit.includes('395') && !opened.billingTotal.includes('1,069'), `The example account's balances are still shown for an opened Hangar Link file: ${JSON.stringify(opened)}`);
  await evaluate("document.querySelector('#messageDialog').close()");

  const rows = "[...document.querySelectorAll('#inventoryRows tr')].map(row => row.textContent.replace(/\\s+/g, ' ').trim())";
  await evaluate("document.querySelector('[data-view=\"hangar\"]').click()");
  await waitFor("document.querySelectorAll('#inventoryRows tr').length===3");
  const hangar = await evaluate(rows);
  assert(
    hangar.some(row => row.includes('Package - Weekend Warrior - LTI') && row.includes('October 22, 2013')) && hangar.some(row => row.includes('Package - AMD Never Settle Space Edition') && row.includes('September 2, 2014')),
    `The hangar of the Hangar Link file is not listed with its dates: ${JSON.stringify(hangar)}`
  );
  await evaluate("document.querySelector('[data-view=\"buybacks\"]').click()");
  await waitFor("document.querySelectorAll('#inventoryRows tr').length===4");
  const buybacks = await evaluate(rows);
  assert(
    buybacks.some(row => row.includes('Standalone Ship - Aegis Eclipse LTI') && row.includes('May 19, 2017')) && buybacks.some(row => row.includes('Package - Citizen Starter Pack')),
    `The buy-backs of the Hangar Link file are not listed: ${JSON.stringify(buybacks)}`
  );
  const flagged = await evaluate("({ghostRows:document.querySelectorAll('#inventoryRows tr.record-ghost').length, label:document.body.textContent.includes('POTENTIAL GHOST REMOVAL')})");
  assert(flagged.ghostRows === 0 && !flagged.label, `An opened Hangar Link file must flag no removal: ${JSON.stringify(flagged)}`);
}

// A Hangar Link file chosen with Load opens as an incomplete build: its hangar and buy-backs are shown, every other
// section is empty and marked as not read, and nothing in it is flagged as removed.
export async function checkHangarLinkImport() {
  await checkHangarLinkFileOpens();
  return checkHangarLinkRoundTripCreditCostAndRefusal();
}

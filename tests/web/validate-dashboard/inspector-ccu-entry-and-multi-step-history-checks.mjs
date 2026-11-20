import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { assertInspectorPrice } from "./example-ccu-history-checks.mjs";
import { checkFloatingGeometry } from "./geometry-probe-prelude-and-floating-geometry-check.mjs";
import { captureScreenshots } from "./run-options-and-work-folders.mjs";

export async function checkInspectorCcuEntryAndZeroVersusMissingMoney() {
  await evaluate("document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-1\"] .record-button').click()");
  await assertInspectorPrice('Melt Value','$185.00 USD');
  assert(
    await evaluate("!document.querySelector('#inspectorCcu').hidden && document.querySelector('#inspectorCcu').getAttribute('aria-haspopup')==='dialog' && document.querySelector('#inspectorCcu').getAttribute('aria-controls')==='ccuDialog'"),
    'Inspector did not expose an accessible history entry for the upgraded example.'
  );
  await evaluate("document.querySelector('#inspectorCcu').focus();document.querySelector('#inspectorCcu').click()");
  await waitFor("document.querySelector('#ccuDialog').open && document.querySelectorAll('#ccuSteps li').length===1");
  assert(await evaluate("document.querySelector('#ccuSteps').textContent.includes('Super Hornet') && document.querySelector('#ccuSteps').textContent.includes('Heartseeker Mk I')"), 'Inspector CCU entry opened a different history.');
  await evaluate("document.querySelector('#ccuDialog .dialog-close').click()");
  await waitFor("!document.querySelector('#ccuDialog').open && document.activeElement===document.querySelector('#inspectorCcu')");
  await evaluate("document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-3\"] .record-button').click()");
  assert(await evaluate("document.querySelector('#inspectorCcu').hidden && !document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-3\"] .ccu-history-button')"), 'An unchanged example record displayed invented CCU history.');
  await assertInspectorPrice('Melt Value','—');

  await evaluate("document.querySelector('[data-view=\"buybacks\"]').click();document.querySelector('#inventoryRows tr[data-record-key=\"demo-buyback-1\"] .record-button').click()");
  await assertInspectorPrice('Buyback Price','$5.00 USD');
  assert(await evaluate("!document.querySelector('#inventoryRows .ccu-history-button') && document.querySelector('#inspectorCcu').hidden"), 'Buybacks displayed unsupported example CCU controls.');

  await evaluate(`(() => {
    window.__originalPledgeDetails=window.CITIZENDATA_DEMO_PLEDGE_DETAILS;
    window.CITIZENDATA_DEMO_PLEDGE_DETAILS={...window.__originalPledgeDetails,
      'demo-pledge-1':{...window.__originalPledgeDetails['demo-pledge-1'],meltValue:{amount:'0.00',currency:'USD'}},
      'demo-buyback-1':{...window.__originalPledgeDetails['demo-buyback-1'],buybackPrice:{amount:'0.00',currency:'USD'}}
    };
    document.querySelector('#inventoryRows tr[data-record-key="demo-buyback-1"] .record-button').click();
  })()`);
  await assertInspectorPrice('Buyback Price','$0.00 USD');
  await evaluate("document.querySelector('[data-view=\"hangar\"]').click();document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-1\"] .record-button').click()");
  await assertInspectorPrice('Melt Value','$0.00 USD');
  await evaluate("window.CITIZENDATA_DEMO_PLEDGE_DETAILS['demo-pledge-1'].meltValue=null;document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-1\"] .record-button').click()");
  await assertInspectorPrice('Melt Value','—');
  await evaluate("delete window.CITIZENDATA_DEMO_PLEDGE_DETAILS['demo-pledge-1'].meltValue;document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-1\"] .record-button').click()");
  await assertInspectorPrice('Melt Value','—');
}

export async function checkMultiStepCcuHistoryWithZeroAndMissingCosts() {
  await evaluate(`(() => {
    const original=window.__originalPledgeDetails['demo-pledge-1'];
    window.CITIZENDATA_DEMO_PLEDGE_DETAILS['demo-pledge-1']={...original,ccuHistory:[...original.ccuHistory,
      {fromShip:'Heartseeker Mk I',toShip:'Zero-cost test upgrade',appliedDateRaw:null,cost:{amount:'0.00',currency:'USD'},cumulativeValue:{amount:'185.00',currency:'USD'}},
      {fromShip:'Zero-cost test upgrade',toShip:'Unknown-cost test upgrade',cost:null,cumulativeValue:null}
    ]};
    document.querySelector('#inventoryRows tr[data-record-key="demo-pledge-1"] .record-button').click();
    document.querySelector('#inspectorCcu').focus();document.querySelector('#inspectorCcu').click();
  })()`);
  await waitFor("document.querySelector('#ccuDialog').open && document.querySelectorAll('#ccuSteps li').length===3");
  assert(await evaluate(`(() => {
    const rows=[...document.querySelectorAll('#ccuSteps li')];
    return rows[1].querySelector('.ccu-cost .ccu-value').textContent==='$0.00 USD' && rows[1].querySelector('.ccu-total .ccu-value').textContent==='$185.00 USD'
      && rows[2].querySelector('.ccu-cost .ccu-value').textContent==='—' && rows[2].querySelector('.ccu-total .ccu-value').textContent==='—'
      && rows[1].querySelector('.ccu-applied .ccu-value').textContent==='—' && rows[2].querySelector('.ccu-applied .ccu-value').textContent==='—';
  })()`), 'CCU history conflated a real zero-cost upgrade with missing cost or cumulative value.');
  await setViewport(390,844);
  await checkFloatingGeometry('#ccuDialog','Multi-step CCU history with zero and missing costs');
  if(captureScreenshots)await captureElement('#ccuDialog','work-temp-ccu-zero-null-cost-390.png');
  await evaluate("document.querySelector('#ccuDialog .dialog-close').click()");
  await waitFor("!document.querySelector('#ccuDialog').open");
  for(const rawValue of ['', '   ', 42, {}]) {
    await evaluate(`(() => {
      const details=window.CITIZENDATA_DEMO_PLEDGE_DETAILS['demo-pledge-1'];
      details.ccuHistory[0]={...window.__originalPledgeDetails['demo-pledge-1'].ccuHistory[0],appliedDateRaw:${JSON.stringify(rawValue)}};
      document.querySelector('#inspectorCcu').click();
    })()`);
    await waitFor("document.querySelector('#ccuDialog').open");
    assert(await evaluate("document.querySelector('#ccuSteps li .ccu-applied .ccu-value').textContent==='—'"), `Invalid or empty Applied value was displayed as a date: ${JSON.stringify(rawValue)}.`);
    await evaluate("document.querySelector('#ccuDialog .dialog-close').click()");
    await waitFor("!document.querySelector('#ccuDialog').open");
  }
  await evaluate(`(() => {
    window.CITIZENDATA_DEMO_PLEDGE_DETAILS['demo-pledge-1'].ccuHistory[0]={...window.__originalPledgeDetails['demo-pledge-1'].ccuHistory[0],appliedDateRaw:'  February 12, 2021  '};
    document.querySelector('#inspectorCcu').click();
  })()`);
  await waitFor("document.querySelector('#ccuDialog').open");
  assert(await evaluate("document.querySelector('#ccuSteps li .ccu-applied .ccu-value').textContent==='February 12, 2021'"), 'Applied date was not kept as trimmed source text.');
  await evaluate("document.querySelector('#ccuDialog .dialog-close').click()");
  await waitFor("!document.querySelector('#ccuDialog').open");
  await evaluate("window.CITIZENDATA_DEMO_PLEDGE_DETAILS=window.__originalPledgeDetails;delete window.__originalPledgeDetails");
  await evaluate("document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-1\"] .record-button').click()");
  await setViewport(1600,1800);
  await evaluate("window.scrollTo({top:0,left:0,behavior:'instant'})");
}

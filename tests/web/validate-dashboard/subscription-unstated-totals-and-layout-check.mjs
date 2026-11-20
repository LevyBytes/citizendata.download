import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement, loadFixture, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { checkDashboardGeometry } from "./dashboard-geometry-check.mjs";
import { captureScreenshots } from "./run-options-and-work-folders.mjs";

export async function checkUnstatedTotalsPartialHistoryAndLayoutAtWidths() {
  // A running subscription RSI states no total for, beside ended ones with totals, in a complete build.
  await loadFixture('subscription-running-without-total.json', `
    documentCopy.financial.subscriptions[1] = {...documentCopy.financial.subscriptions[1], totalPaid:null, totalTimeRaw:null, payments:[]};
  `);
  assert(await evaluate("document.querySelector('#subscriptionNote').hidden && !document.querySelector('#subscriptionMetricDetail').textContent.includes('Partial data') && document.querySelector('#subscriptionSpent').textContent==='$420.00' && "
    + "document.querySelector('#subscriptionTier').textContent==='Imperator'"), 'A running subscription without a total made a complete build read as partial.');

  // The same subscriptions from a section that did not finish are partial.
  await loadFixture('subscription-section-partial.json', `
    documentCopy.financial.subscriptions[1] = {...documentCopy.financial.subscriptions[1], totalPaid:null, totalTimeRaw:null, payments:[]};
    documentCopy.sync.sectionOutcomes['financial.subscriptions'].status = 'partial';
  `);
  assert(
    await evaluate("!document.querySelector('#subscriptionNote').hidden && document.querySelector('#subscriptionNote').textContent==='Partial history' && document.querySelector('#subscriptionMetricDetail').textContent.includes('Partial data')"),
    'A subscription section that did not finish hid its incomplete-history state.'
  );

  await loadFixture('subscription-mixed-currencies.json', "documentCopy.financial.subscriptions[1].totalPaid.currency='EUR';");
  assert(await evaluate(`(() => {
    const expected=['20 EUR','$420.00 USD'];
    return ['subscriptionSpent','subscriptionDetailSpent'].every(id=>
      JSON.stringify([...document.getElementById(id).querySelectorAll('.subscription-amount')].map(node=>node.textContent))===JSON.stringify(expected));
  })()`), 'Different subscription currencies were combined, mislabeled, or omitted.');

  await loadFixture('subscription-long-amounts.json', `
    documentCopy.financial.subscriptions[0].totalPaid.amount='9999999999999999.1234';
    documentCopy.financial.subscriptions[1].totalPaid={amount:'8888888888888888.5678',currency:'EUR'};
  `);
  assert(
    await evaluate("document.querySelector('#subscriptionSpent').textContent.includes('9,999,999,999,999,999.1234') && document.querySelector('#subscriptionSpent').textContent.includes('8,888,888,888,888,888.5678')"),
    'Long subscription totals lost exact decimal precision.'
  );
  for (const width of [1280,640,390,320]) {
    await setViewport(width);
    await checkDashboardGeometry(`long mixed-currency subscriptions at ${width}px`);
    if (captureScreenshots && width===320) {
      await captureElement('#subscriptions','work-temp-subscription-long-320.png');
      await captureElement('.summary-strip','work-temp-subscription-summary-long-320.png');
    }
  }
}

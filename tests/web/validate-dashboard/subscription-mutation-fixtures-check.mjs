import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { checkSubscriptionTier } from "./subscription-tier-and-fixtures-checks.mjs";

export async function checkSubscriptionMutationFixtures() {
  await loadFixture('subscription-centurion.json', `
    documentCopy.financial.subscriptions = [documentCopy.financial.subscriptions[0]];
    documentCopy.financial.subscriptions[0].state = 'active';
  `);
  await checkSubscriptionTier('Centurion', '$420.00', 'rgb(84, 173, 247)');

  for (const [name,mutation] of [
    ['empty', 'documentCopy.financial.subscriptions = [];'],
    ['unknown', `documentCopy.financial.subscriptions = [{
      ...documentCopy.financial.subscriptions[0],
      subscriptionId:'unknown-plan',plan:'Unknown Plan',state:'ended',amount:null,totalPaid:null,payments:[]
    }];`]
  ]) {
    // Each empty/unknown document replaces a real active tier, so stale UI is exercised.
    await loadFixture(`subscription-before-${name}.json`);
    await loadFixture(`subscription-${name}.json`,mutation);
    assert(await evaluate(`(() => {
      return ['subscriptionSummaryIcon','subscriptionStatusIcon'].every(id=>document.getElementById(id).hidden)
        && ['subscriptionTier','subscriptionSpent','subscriptionDetailSpent'].every(id=>document.getElementById(id).textContent==='')
        && ['subscriptionSummary','subscriptions'].every(id=>document.getElementById(id).dataset.tier==='')
        && !/Imperator|Centurion|440/.test(document.querySelector('#subscriptionMetricDetail').textContent);
    })()`), `${name} subscription data left a previous tier, icon, or total in the UI.`);
    if (name !== 'unknown') assert(await evaluate("document.querySelector('#subscriptionMetricDetail').textContent==='' && document.querySelector('#subscriptionNote').hidden"), `${name} subscription data invented a status or partial-history warning.`);
  }

  await loadFixture('subscription-ended.json', 'documentCopy.financial.subscriptions = [documentCopy.financial.subscriptions[0]];');
  assert(await evaluate("document.querySelector('#subscriptionTier').textContent==='' && document.querySelector('#subscriptionSummaryIcon').hidden && document.querySelector('#subscriptionStatusIcon').hidden && document.querySelector('#subscriptionSpent')"
    + ".textContent==='$420.00' && document.querySelector('#subscriptionDetailSpent').textContent==='$420.00 USD'"), 'Ended subscriptions lost historical spending or appeared as an active tier.');

  await loadFixture('subscription-total-not-payments.json', `
    documentCopy.financial.subscriptions[0].payments = [{rawTimestamp:'November 1, 2026',processor:null,status:'paid',amount:{amount:'100.00',currency:'USD'}}];
  `);
  await checkSubscriptionTier('Imperator', '$440.00', 'rgb(219, 175, 112)');
  assert(await evaluate("document.querySelector('#subscriptionNote').hidden"), 'Complete reported subscription totals were marked partial.');

  await loadFixture('subscription-payment-history.json', `
    documentCopy.financial.subscriptions = [{
      ...documentCopy.financial.subscriptions[0],
      subscriptionId:'payments-only',plan:'Centurion Monthly Plan',state:'active',totalPaid:null,
      payments:[
        {rawTimestamp:'November 1, 2026',processor:null,status:'paid',amount:{amount:'12.3456',currency:'USD'}},
        {rawTimestamp:'October 1, 2026',processor:null,status:'Completed',amount:{amount:'2.0001',currency:'USD'}},
        {rawTimestamp:'September 1, 2026',processor:null,status:'pending',amount:{amount:'999.00',currency:'USD'}},
        {rawTimestamp:'August 1, 2026',processor:null,status:'failed',amount:{amount:'999.00',currency:'USD'}}
      ]
    }];
  `);
  await checkSubscriptionTier('Centurion', '$14.3457', 'rgb(84, 173, 247)');
  assert(await evaluate("document.querySelector('#subscriptionNote').hidden && !document.querySelector('#subscriptionMetricDetail').textContent.includes('Partial data')"), 'A subscription total of a complete build was called partial.');
}

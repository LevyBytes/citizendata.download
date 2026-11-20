import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

// A CCU is shown by the ship it leads to: the Record Images view and the inspector open on that image, the last one
// of a hangar CCU. Any other record opens on its first image.
export async function checkCcuLeadImage() {
  await reloadDashboard();
  await loadFixture('ccu-lead-image-fixture.json', `
    const image=(name)=>({imageKey:name.padEnd(64,'0'),normalizationVersion:1,role:'thumbnail',url:'https://media.robertsspaceindustries.com/synthetic/'+name+'.png',altText:name,width:null,height:null,mimeTypeHint:null});
    const [ccu,plain]=documentCopy.pledges;
    ccu.category='shipUpgrade';ccu.title='Upgrade - Example Alpha to Example Beta Standard Edition';
    ccu.images=[image('d0'),image('d1')];
    ccu.items=[{...(ccu.items?.[0]??{}),recordKey:'ccu-lead-item',name:'Example Beta',images:[image('d1')]}];
    plain.title='Example Plain Pledge';plain.images=[image('e0'),image('e1')];for(const item of plain.items??[])item.images=[];
  `);
  const pressed = (container) => `[...document.querySelectorAll('${container} .media-thumbnail')].map((button)=>button.getAttribute('aria-pressed'))`;
  const open = async (title) => {
    await evaluate(`(()=>{const row=[...document.querySelectorAll('#inventoryRows tr')].find((candidate)=>candidate.textContent.includes(${JSON.stringify(title)}));row.querySelector('.media-gallery-trigger').click();return true})()`);
    await waitFor("document.getElementById('mediaGalleryDialog').open");
    const gallery = await evaluate(pressed('#mediaGalleryThumbnails'));
    await evaluate(`(()=>{document.getElementById('mediaGalleryDialog').close();const row=[...document.querySelectorAll('#inventoryRows tr')].find((candidate)=>candidate.textContent.includes(${JSON.stringify(title)}));row.querySelector('.record-button')`
      + `.click();return true})()`);
    await waitFor(`document.querySelectorAll('#inspectorGalleryThumbnails .media-thumbnail').length===2`);
    return { gallery, inspector: await evaluate(pressed('#inspectorGalleryThumbnails')) };
  };
  const ccu = await open('Upgrade - Example Alpha to Example Beta');
  assert(JSON.stringify(ccu) === JSON.stringify({ gallery: ["false", "true"], inspector: ["false", "true"] }), `A hangar CCU did not open on the image of the ship it leads to: ${JSON.stringify(ccu)}`);
  const plain = await open('Example Plain Pledge');
  assert(JSON.stringify(plain) === JSON.stringify({ gallery: ["true", "false"], inspector: ["true", "false"] }), `A record that is not a CCU did not open on its first image: ${JSON.stringify(plain)}`);
}

// A buy-back whose own page was read shows that page's price, discount, and contents, and links to that page.
export async function checkBuybackDetails() {
  await reloadDashboard();
  await loadFixture('buyback-details-fixture.json', `
    const observedAt = documentCopy.buybacks[0].observation.lastObservedAt;
    documentCopy.buybacks.forEach((record, index) => {
      record.buybackId = 21000001 + index;
      record.sourcePage = 1;
      record.sourceLinks = [{ kind: 'listing', url: 'https://robertsspaceindustries.com/account/buy-back-pledges?page=1&pagesize=100', observedAt }];
    });
    const priced = documentCopy.buybacks[0];
    priced.items = [];
    priced.sourceLinks.push({ kind: 'detail', url: 'https://robertsspaceindustries.com/pledge/buyback/' + priced.buybackId, observedAt });
    priced.buybackPrice = { amount: '17.00', currency: 'USD' };
    const upgrade = documentCopy.buybacks[1];
    upgrade.kind = 'upgrade';
    upgrade.buybackPrice = null;
    upgrade.upgrade = { fromShipIdentifiers: [], toShipIdentifiers: [], skuIdentifiers: [] };
    documentCopy.buybackDetails = [{
      buybackId: priced.buybackId, recordKey: 'buyback-detail:' + priced.buybackId, title: priced.title, categoryLabel: 'Package', name: 'Example Pack', pageType: 'game-packages',
      price: { amount: '17.00', currency: 'USD' }, priceText: '$17.00 USD', originalPrice: { amount: '20.00', currency: 'USD' }, discountPercent: 15, discountText: 'Save 15%',
      priceDataValue: null, priceDataCurrency: null, skuId: null, descriptionTitle: null, description: 'An example description.',
      ships: [{ name: 'Example Ship', manufacturer: 'Example Maker', focus: 'Light Fighter', shipPageUrl: null, images: [] }], alsoContains: ['Self-Land Hangar'], images: [],
      buybackTokensAvailable: 2, sourceUrl: 'https://robertsspaceindustries.com/en/pledge/buyback/' + priced.buybackId, capturedAt: '2026-11-19T12:00:00.000Z'
    }];
    documentCopy.sync.sectionOutcomes.buybackDetails = { ...documentCopy.sync.sectionOutcomes.buybacks, records: 1 };
    window.__buybackKeys = { priced: priced.recordKey, upgrade: upgrade.recordKey, plain: documentCopy.buybacks[2].recordKey, id: priced.buybackId };
  `);
  const inspected = (key) => evaluate(`(() => {
    document.querySelector('[data-view="buybacks"]').click();
    document.querySelector('#inventoryRows tr[data-record-key="' + window.__buybackKeys[${JSON.stringify(key)}] + '"] .record-button').click();
    const source = document.querySelector('#inspectorSource');
    return {
      facts: [...document.querySelectorAll('#inspectorFacts > div')].map((row) => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]).slice(3),
      items: [...document.querySelectorAll('#inspectorItemList .inspector-item')].map((card) => [card.querySelector('b').textContent, card.querySelector('small').textContent]),
      link: source.hidden ? null : source.getAttribute('href'), id: window.__buybackKeys.id
    };
  })()`);
  const priced = await inspected('priced');
  assert(
    JSON.stringify(priced.facts) === JSON.stringify([["Price Read", "November 19, 2026"], ["Before Discount", "$20.00 USD"], ["Discount", "Save 15%"], ["Buyback Price", "$17.00 USD"]]),
    `A buy-back with a captured page did not show its price as captured: ${JSON.stringify(priced.facts)}`
  );
  assert(JSON.stringify(priced.items) === JSON.stringify([["Example Ship", "Example Maker · Light Fighter"], ["Self-Land Hangar", "Also contains"]]), `A buy-back with a captured page did not show that page's contents: ${JSON.stringify(priced.items)}`);
  assert(priced.link === `https://robertsspaceindustries.com/pledge/buyback/${priced.id}`, `A buy-back's RSI link should open its own page, not the list: ${priced.link}`);
  const upgrade = await inspected('upgrade');
  assert(
    JSON.stringify(upgrade.facts) === JSON.stringify([["Buyback Price", "Varies, check on RSI"]]) && upgrade.link === 'https://robertsspaceindustries.com/account/buy-back-pledges?page=1&pagesize=100',
    `An upgrade buy-back should say its price varies and link the list page: ${JSON.stringify(upgrade)}`
  );
  const plain = await inspected('plain');
  assert(JSON.stringify(plain.facts) === JSON.stringify([["Buyback Price", "—"]]), `A buy-back without a captured page should show no price: ${JSON.stringify(plain.facts)}`);
}

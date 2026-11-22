import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";

const commonExpected = { category: ["Armor", "Weapon"], date: ["January 1, 2001", "January 1, 2105"], media: ["No images", "1 image"] };

async function clickAndRead(key) {
  return evaluate(`(() => {
    const button = document.querySelector('[data-inventory-sort="${key}"]');
    button.click();
    const row = document.querySelector('#inventoryRows tr');
    const cells = [...row.cells];
    const value = ${JSON.stringify(key)} === 'record' ? row.querySelector('.record-button b').textContent
      : ${JSON.stringify(key)} === 'category' ? cells[1].lastChild.textContent
      : ${JSON.stringify(key)} === 'value' ? cells[2].querySelector('.inventory-amount').textContent
      : ${JSON.stringify(key)} === 'date' ? cells[3].lastChild.textContent
      : cells[4].querySelector('.media-label').textContent;
    return {value,ariaSort:button.closest('th').getAttribute('aria-sort'),rows:document.querySelectorAll('#inventoryRows tr').length};
  })()`);
}

export async function checkInventorySorting() {
  await loadFixture("inventory-sorting-fixture.json", `
    const categories = ['hangarItem', 'armor', 'weapon', 'gamePackage'];
    const template = documentCopy.pledges[0];
    documentCopy.pledges = Array.from({length:105}, (_, offset) => {
      const number = offset + 1;
      return {...structuredClone(template), pledgeId:10000 + number, recordKey:'sort-' + number,
        title:'Record ' + String(number).padStart(3, '0'), category:categories[offset % categories.length],
        createdDateRaw:'January 1, ' + (2000 + number), items:[], images:number % 2 ? structuredClone(template.images) : [],
        meltValue:number % 10 ? {amount:number + '.00', currency:'USD'} : null};
    });
    const buyback = documentCopy.buybacks[0];
    documentCopy.buybacks = Array.from({length:105}, (_, offset) => {
      const number = offset + 1;
      return {...structuredClone(buyback), buybackId:20000 + number, recordKey:'buyback-sort-' + number,
        title:'Buyback ' + String(number).padStart(3, '0'), category:categories[offset % categories.length],
        reclaimDateRaw:'January 1, ' + (2000 + number), items:[], images:number % 2 ? structuredClone(buyback.images) : [],
        buybackPrice:number % 10 ? {amount:number + '.50', currency:'USD'} : null};
    });
  `);
  for (const dataset of [
    {view:"hangar",prefix:"Record",value:["$1.00 USD","$105.00 USD"]},
    {view:"buybacks",prefix:"Buyback",value:["$1.50 USD","$105.50 USD"]}
  ]) {
    await evaluate(`document.querySelector('[data-view="${dataset.view}"]').click()`);
    const expected = {...commonExpected,record:[`${dataset.prefix} 001`,`${dataset.prefix} 105`],value:dataset.value};
    for (const key of Object.keys(expected)) {
      const ascending = await clickAndRead(key);
      const descending = await clickAndRead(key);
      assert(ascending.ariaSort === "ascending" && ascending.value === expected[key][0], `${dataset.view} ${key} ascending failed: ${JSON.stringify(ascending)}`);
      assert(descending.ariaSort === "descending" && descending.value === expected[key][1], `${dataset.view} ${key} descending failed: ${JSON.stringify(descending)}`);
      assert(ascending.rows === 100 && descending.rows === 100, `${dataset.view} ${key} did not retain the 100-row first page.`);
    }
    const secondPage = await evaluate(`(() => {
      document.querySelector('[data-inventory-sort="record"]').click();
      document.querySelector('#inventoryNext').click();
      return [...document.querySelectorAll('#inventoryRows .record-button b')].map((node) => node.textContent);
    })()`);
    const expectedPage = [101,102,103,104,105].map((number) => `${dataset.prefix} ${number}`);
    assert(JSON.stringify(secondPage) === JSON.stringify(expectedPage), `${dataset.view} sorted only one page: ${JSON.stringify(secondPage)}`);
    await evaluate(`document.querySelector('[data-inventory-sort="media"]').click()`);
  }
}

import { assert, inventoryState } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

export async function checkInventoryPagingSearchAndFilters() {
  // 250 hangar and 130 buyback records. Each title carries its index so a search can target one record on a later page.
  await loadFixture("paging-fixture.json", `
    const grow=(records,count,prefix)=>Array.from({length:count},(_,index)=>{
      const record=structuredClone(records[index%records.length]);
      const number=String(index+1).padStart(3,'0');
      record.recordKey=prefix+'-'+number;
      record.title='Paging '+prefix+' record '+number;
      return record;
    });
    documentCopy.pledges=grow(documentCopy.pledges,250,'hangar');
    documentCopy.buybacks=grow(documentCopy.buybacks,130,'buyback');
  `);
  await waitFor("document.querySelectorAll('#inventoryRows tr').length===100");
  const firstPage = await evaluate(inventoryState);
  assert(firstPage.pagination && firstPage.status.includes("250 records") && firstPage.status.includes("page 1 of 3") && firstPage.previousDisabled && !firstPage.nextDisabled && firstPage.count === "1 to 100 of 250",
    `The first inventory page did not show 100 of 250 records with paging controls: ${JSON.stringify(firstPage)}`);
  // The page bar sits directly under the record list: beside the inspector on a wide page, above it on a narrow one.
  const barPlace = `(()=>{
    const shell=document.querySelector('.table-shell').getBoundingClientRect(),bar=document.getElementById('inventoryPagination').getBoundingClientRect(),inspector=document.getElementById('recordInspector').getBoundingClientRect();
    return {gap:Math.round(bar.top-shell.bottom),left:Math.round(bar.left-shell.left),width:Math.round(bar.width-shell.width),besideInspector:inspector.left>=bar.right-1,aboveInspector:inspector.top>=bar.bottom-1};
  })()`;
  const viewport = await evaluate("({width:innerWidth,height:innerHeight})");
  const resize = (width, height) => command("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false });
  await resize(1600, 1800);
  const wideBar = await evaluate(barPlace);
  assert(wideBar.gap === 0 && wideBar.left === 0 && wideBar.width === 0 && wideBar.besideInspector, `On a wide page the page bar is not directly under the record list, beside the inspector: ${JSON.stringify(wideBar)}`);
  await resize(1100, 1800);
  const stackedBar = await evaluate(barPlace);
  assert(stackedBar.gap === 0 && stackedBar.left === 0 && stackedBar.width === 0 && stackedBar.aboveInspector && !stackedBar.besideInspector, `On a narrow page the page bar is not between the record list and the inspector: ${JSON.stringify(stackedBar)}`);
  await resize(viewport.width, viewport.height);
  const firstPageKeys = await evaluate("[...document.querySelectorAll('#inventoryRows tr')].map(row=>row.dataset.recordKey)");
  await evaluate("document.querySelector('.table-shell').scrollTop=400;document.getElementById('inventoryNext').click()");
  const secondPage = await evaluate(inventoryState);
  const secondPageKeys = await evaluate("[...document.querySelectorAll('#inventoryRows tr')].map(row=>row.dataset.recordKey)");
  assert(secondPage.rows === 100 && secondPage.status.includes("page 2 of 3") && !secondPage.previousDisabled && !secondPage.nextDisabled && secondPage.count === "101 to 200 of 250" && secondPage.scrollTop === 0
    && secondPageKeys.every(key => !firstPageKeys.includes(key)), `The second inventory page repeated records or kept the old scroll position: ${JSON.stringify(secondPage)}`);
  await evaluate("document.getElementById('inventoryNext').click()");
  const lastPage = await evaluate(inventoryState);
  const lastPageKeys = await evaluate("[...document.querySelectorAll('#inventoryRows tr')].map(row=>row.dataset.recordKey)");
  assert(lastPage.rows === 50 && lastPage.status.includes("page 3 of 3") && lastPage.nextDisabled && lastPage.count === "201 to 250 of 250"
    && new Set([...firstPageKeys, ...secondPageKeys, ...lastPageKeys]).size === 250, `The last inventory page did not complete the 250 records exactly once: ${JSON.stringify(lastPage)}`);

  // A search issued on the last page must still find a record that sits on the first page of the whole dataset.
  const target = firstPageKeys[4];
  const targetTitle = await evaluate(`window.__pagingTitle=(()=>{const number=${JSON.stringify(target)}.split('-').at(-1);return 'Paging hangar record '+number})()`);
  await evaluate(`document.getElementById('recordSearch').value=${JSON.stringify(targetTitle)};document.getElementById('recordSearch').dispatchEvent(new Event('input',{bubbles:true}))`);
  const searched = await evaluate(inventoryState);
  assert(searched.rows === 1 && searched.first === target && !searched.pagination && searched.count === "1 shown of 250" && searched.inspector === targetTitle,
    `Search did not run across the whole dataset before paging: ${JSON.stringify(searched)}`);
  await evaluate("document.getElementById('recordSearch').value='Paging hangar record 2';document.getElementById('recordSearch').dispatchEvent(new Event('input',{bubbles:true}))");
  const partial = await evaluate(inventoryState);
  assert(partial.rows === 51 && !partial.pagination && partial.count === "51 shown of 250", `A search matching 51 records across pages did not list them all on one page: ${JSON.stringify(partial)}`);
  await evaluate("document.getElementById('recordSearch').value='Paging hangar record';document.getElementById('recordSearch').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('inventoryNext').click();"
    + "document.getElementById('inventoryNext').click()");
  assert((await evaluate(inventoryState)).status.includes("page 3 of 3"), "Paging within a search result did not reach its last page.");
  await evaluate("document.getElementById('recordSearch').value='Paging hangar record 0';document.getElementById('recordSearch').dispatchEvent(new Event('input',{bubbles:true}))");
  const narrowed = await evaluate(inventoryState);
  assert(narrowed.rows === 99 && !narrowed.pagination && narrowed.count === "99 shown of 250", `Narrowing a search from page 3 did not return to the first page of the new result: ${JSON.stringify(narrowed)}`);

  await evaluate("document.getElementById('recordSearch').value='';document.getElementById('recordSearch').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('inventoryNext').click();document.querySelector('[data-view=\"buybacks\"]')"
    + ".click()");
  const buybacks = await evaluate(inventoryState);
  assert(buybacks.rows === 100 && buybacks.status.includes("130 records") && buybacks.status.includes("page 1 of 2") && buybacks.count === "1 to 100 of 130", `Switching to Buybacks did not start at its own first page: ${JSON.stringify(buybacks)}`);
  await evaluate("document.getElementById('inventoryNext').click()");
  const categories = await evaluate("(()=>{document.getElementById('filterButton').click();const chip=[...document.querySelectorAll('.filter-chip')].find(candidate=>candidate.dataset.group!=='all');chip.click();return chip.dataset.group})()");
  const filtered = await evaluate(inventoryState);
  assert(!filtered.status.includes("page 2") && (filtered.rows > 0 || filtered.empty), `Choosing the ${categories} category from page 2 did not return to the first page of the filtered result: ${JSON.stringify(filtered)}`);
  await evaluate("document.getElementById('clearFilters').click();document.getElementById('filterButton').click();document.querySelector('[data-view=\"hangar\"]').click()");
}

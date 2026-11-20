import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement, loadFixture, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkFloatingGeometry } from "./geometry-probe-prelude-and-floating-geometry-check.mjs";
import { checkInspectorCcuEntryAndZeroVersusMissingMoney, checkMultiStepCcuHistoryWithZeroAndMissingCosts } from "./inspector-ccu-entry-and-multi-step-history-checks.mjs";
import { captureScreenshots } from "./run-options-and-work-folders.mjs";

export async function assertInspectorPrice(label, value) {
  assert(await evaluate(`(() => {
    const fact=document.querySelector('#inspectorFacts').lastElementChild;
    return fact?.querySelector('dt')?.textContent===${JSON.stringify(label)} && fact?.querySelector('dd')?.textContent===${JSON.stringify(value)};
  })()`), `Inspector's final fact should be ${label}: ${value}.`);
}

async function checkExampleCcuControlAndDialogAtEightViewports() {
  const rowControl = '#inventoryRows tr[data-record-key="demo-pledge-1"] .ccu-history-button';
  assert(await evaluate(`(() => {
    const controls=[...document.querySelectorAll('#inventoryRows .ccu-history-button')];
    const button=document.querySelector(${JSON.stringify(rowControl)});
    return controls.length===1 && controls[0]===button && button.tagName==='BUTTON' && button.type==='button'
      && button.getAttribute('aria-haspopup')==='dialog' && button.getAttribute('aria-controls')==='ccuDialog'
      && /CCU|upgrade/i.test(button.getAttribute('aria-label')??button.textContent)
      && !document.querySelector('#inventoryRows button button') && !button.closest('.record-button');
  })()`), 'The upgraded example must have exactly one accessible CCU control outside its record-selection button.');

  for (const [width,height] of [[1280,1000],[761,1000],[760,1000],[441,844],[440,844],[390,844],[320,480],[640,320]]) {
    await setViewport(width,height);
    await evaluate(`document.querySelector(${JSON.stringify(rowControl)}).focus();document.querySelector(${JSON.stringify(rowControl)}).click()`);
    await waitFor("document.querySelector('#ccuDialog').open");
    assert(await evaluate(`(() => {
      const dialog=document.querySelector('#ccuDialog');
      const label=document.getElementById(dialog.getAttribute('aria-labelledby'));
      const rows=[...document.querySelectorAll('#ccuSteps li')];
      return dialog instanceof HTMLDialogElement && dialog.matches(':modal') && !!label?.textContent.trim()
        && rows.length===1 && /Super Hornet/.test(rows[0].textContent) && /Heartseeker Mk I/.test(rows[0].textContent)
        && [...rows[0].children].map(cell=>cell.className).join('|')==='ccu-from|ccu-to|ccu-applied|ccu-cost|ccu-total'
        && rows[0].querySelector('.ccu-applied .ccu-label').textContent==='Applied'
        && rows[0].querySelector('.ccu-applied .ccu-value').textContent==='February 12, 2021'
        && document.querySelector('#ccuBaseValue').textContent==='$165.00 USD'
        && rows[0].querySelector('.ccu-cost .ccu-value').textContent==='$20.00 USD'
        && rows[0].querySelector('.ccu-total .ccu-value').textContent==='$185.00 USD'
        && dialog.contains(document.activeElement);
    })()`), `CCU dialog is not a named native modal with the single complete upgrade step at ${width}px.`);
    if(captureScreenshots)await captureElement('#ccuDialog',`work-temp-ccu-dialog-${width}x${height}.png`);
    await checkFloatingGeometry('#ccuDialog', `CCU dialog at ${width}x${height}`);
    assert(await evaluate(`(() => {
      const dialog=document.querySelector('#ccuDialog').getBoundingClientRect();
      const contained=[...document.querySelectorAll('#ccuSteps, #ccuSteps li')].every(node=>{
        const rect=node.getBoundingClientRect();
        if(rect.left<dialog.left-1||rect.right>dialog.right+1||node.scrollWidth>node.clientWidth+1)return false;
        const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){
          if(!walker.currentNode.textContent.trim())continue;
          const range=document.createRange();range.selectNodeContents(walker.currentNode);
          if([...range.getClientRects()].some(text=>text.left<rect.left-1||text.right>rect.right+1))return false;
        }
        return true;
      });
      const cells=[...document.querySelector('#ccuSteps li').children].map(node=>node.getBoundingClientRect());
      const overlap=cells.some((a,index)=>cells.slice(index+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
      const wideOrder=innerWidth<=760||cells.every((rect,index)=>Math.abs(rect.top-cells[0].top)<=1&&(index===0||rect.left>=cells[index-1].right));
      return contained&&!overlap&&wideOrder;
    })()`), `CCU step text escapes its container at ${width}px.`);
    if(width===1280){
      await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    }else await evaluate("document.querySelector('#ccuDialog .dialog-close').click()");
    await waitFor(`!document.querySelector('#ccuDialog').open && document.activeElement===document.querySelector(${JSON.stringify(rowControl)})`);
    if(captureScreenshots && [1280,390].includes(width))await captureElement('#inventory',`work-temp-ccu-inventory-${width}.png`,1400);
  }
}

export async function checkExampleCcuHistory() {
  await checkExampleCcuControlAndDialogAtEightViewports();
  await checkInspectorCcuEntryAndZeroVersusMissingMoney();
  return checkMultiStepCcuHistoryWithZeroAndMissingCosts();
}

export async function checkLoadedExampleHasNoDummyHistory() {
  await loadFixture('example-loaded-as-file.json');
  await evaluate("document.querySelector('#inventoryRows tr[data-record-key=\"demo-pledge-1\"] .record-button').click()");
  assert(await evaluate("!document.querySelector('#inventoryRows .ccu-history-button') && document.querySelector('#inspectorCcu').hidden && !document.querySelector('#ccuDialog').open"), 'Loading an account file reused the built-in example CCU history.');
  await assertInspectorPrice('Melt Value','—');
  await evaluate("document.querySelector('[data-view=\"buybacks\"]').click();document.querySelector('#inventoryRows tr[data-record-key=\"demo-buyback-1\"] .record-button').click()");
  await assertInspectorPrice('Buyback Price','—');
}

import path from "node:path";
import { pathToFileURL } from "node:url";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { repositoryRoot } from "./run-options-and-work-folders.mjs";

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Delivers one synthetic extension message to the page, the way the content script posts it.
export function extensionMessage(fields) {
  return `window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.protocol==='file:'?'null':location.origin,data:${fields}}))`;
}

export async function openBuildChooser() {
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#parserOverlay').hidden && !document.querySelector('#buildChoices').hidden");
}

export const buildChooserState = `(()=>{
  const shown=(id)=>document.getElementById(id).getClientRects().length>0;
  const link=document.getElementById('installExtensionAction');
  return {
    notice:shown('extensionNotice'),title:document.getElementById('extensionNoticeTitle').textContent,detail:document.getElementById('extensionNoticeDetail').textContent,
    link:shown('installExtensionAction'),href:link.href,target:link.target,rel:link.rel,linkTitle:document.getElementById('installExtensionTitle').textContent,
    linkDetail:document.getElementById('installExtensionDetail').textContent,
    account:shown('buildAccountAction'),accountDisabled:document.getElementById('buildAccountAction').disabled,images:shown('buildImagesAction'),
    state:document.getElementById('overlayState').textContent,line:document.getElementById('overlayDetail').textContent,imagesDisabled:document.getElementById('buildImagesAction').disabled,logHidden:document.getElementById('eventLog').hidden,
      controlsHidden:document.getElementById('collectionControls').hidden
  };
})()`;

export async function reloadDashboard() {
  await command("Page.navigate", { url: pathToFileURL(path.join(repositoryRoot, "docs", "index.html")).href });
  await waitFor("document.readyState==='complete' && document.querySelectorAll('#inventoryRows tr').length===3");
}

export const inventoryState = `(()=>{
  const rows=[...document.querySelectorAll('#inventoryRows tr')];
  const pagination=document.getElementById('inventoryPagination');
  return {
    rows:rows.length,first:rows[0]?.dataset.recordKey??null,last:rows.at(-1)?.dataset.recordKey??null,
    pagination:pagination.getClientRects().length>0,status:document.getElementById('inventoryPageStatus').textContent,
    previousDisabled:document.getElementById('inventoryPrevious').disabled,nextDisabled:document.getElementById('inventoryNext').disabled,
    count:document.getElementById('resultCount').textContent,selected:document.querySelector('#inventoryRows tr.active, #inventoryRows tr[aria-selected="true"]')?.dataset.recordKey??null,
    inspector:document.getElementById('inspectorTitle').textContent,scrollTop:document.querySelector('.table-shell').scrollTop,empty:!document.getElementById('emptyState').hidden
  };
})()`;

import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { captureElement, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkExportDialog, checkExportPlacement, chooseExport, downloadExport } from "./export-dialog-and-download.mjs";
import { captureScreenshots } from "./run-options-and-work-folders.mjs";

export async function checkExampleExports() {
  for (const [width, height, preset] of [[1280,1000,'inventory'], [640,400,'custom'], [390,844,'referrals'], [320,480,'inventory']]) {
    await setViewport(width, height);
    await checkExportPlacement(`Export card at ${width}px`);
    if (captureScreenshots) await captureElement('#exportData', `work-temp-export-card-${width}.png`);
    await evaluate("document.querySelector('#exportButton').click()");
    assert(await evaluate("document.querySelector('#exportDialog').open && document.activeElement.id==='exportPreset'"), 'Export modal did not open with preset focus.');
    await chooseExport({exportPreset:preset, exportFormat:'native', exportInventoryScope:'both'});
    await checkExportDialog(`Export modal at ${width}x${height}`);
    assert(await evaluate("document.querySelector('#exportSummary').textContent.includes('Example data')"), 'Example export is not clearly identified.');
    if (captureScreenshots) await captureElement('#exportDialog', `work-temp-export-modal-${width}x${height}.png`);
    if (width === 1280) {
      for (let index=0; index<7; index++) {
        await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        const focus = await evaluate("(()=>{const active=document.activeElement;return {inside:document.querySelector('#exportDialog').contains(active),tag:active?.tagName,id:active?.id,body:active===document.body,documentFocused:document.hasFocus()}})"
          + "()");
        if (!focus.inside) {
          // Native Chrome permits traversal into browser chrome. It must not
          // make the modal's inert background reachable, and Tab must return.
          assert(focus.body && !focus.documentFocused, `Tab reached background content at step ${index+1}: ${JSON.stringify(focus)}`);
          await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
          await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
          assert(await evaluate("document.querySelector('#exportDialog').contains(document.activeElement)"), 'Tab did not return from browser chrome to the native export modal.');
        }
        assert(
          await evaluate("(()=>{const focused=document.activeElement;document.querySelector('#loadButton').focus();return document.activeElement===focused&&document.querySelector('#exportDialog').contains(document.activeElement)})()"),
          'Background app controls became focusable while the export modal was open.'
        );
      }
      await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    } else await evaluate("document.querySelector('#exportClose').click()");
    await waitFor("!document.querySelector('#exportDialog').open && document.activeElement.id==='exportButton'");
  }

  await evaluate("document.querySelector('#exportButton').click()");
  for (const [scope, suffix, keys] of [['hangar','hangar',['pledges']], ['buybacks','buybacks',['buybacks']], ['both','hangar-and-buybacks',['pledges','buybacks']]]) {
    await chooseExport({exportPreset:'inventory', exportInventoryScope:scope, exportFormat:'native'});
    const expectedCount = await evaluate(`${JSON.stringify(keys)}.reduce((count,key)=>count+window.CITIZENDATA_DEMO_DATA[key].length,0)`);
    assert(await evaluate('document.querySelector("#exportSummary").textContent') === `${expectedCount} records · Example data`, `${scope}: incorrect inventory count or source.`);
    const data = await downloadExport(`citizendata-example-${suffix}.json`);
    assert(Object.keys(data).sort().join('|')===keys.slice().sort().join('|'), `${scope}: export includes an unselected inventory source.`);
    for (const key of keys) assert(JSON.stringify(data[key]) === await evaluate(`JSON.stringify(window.CITIZENDATA_DEMO_DATA.${key})`), `${scope}: downloaded inventory differs from its source.`);
  }
  for (const [ladder,kind] of [['current','prospects'], ['legacy','recruits']]) {
    await chooseExport({exportPreset:'referrals', exportReferralLadder:ladder, exportReferralKind:kind});
    const data = await downloadExport(`citizendata-example-referrals-${ladder}-${kind}.json`);
    assert(Object.keys(data.referrals).join()===ladder && Object.keys(data.referrals[ladder]).join()===kind, 'Referral selectors did not select the requested ladder and list.');
    assert(JSON.stringify(data.referrals[ladder][kind]) === await evaluate(`JSON.stringify(window.CITIZENDATA_DEMO_DATA.referrals.${ladder}.${kind})`), 'Downloaded referrals lost records or metadata.');
  }
  await chooseExport({exportPreset:'inventory', exportInventoryScope:'both', exportFormat:'hangar-link'});
  // The example account has no RSI pledge numbers, so there is nothing Hangar Link could import.
  assert(
    await evaluate("document.querySelector('#exportDownload').disabled && document.querySelector('#exportMessages').textContent.includes('without an RSI pledge number')"),
    'The example account offered a Hangar Link file, or gave no reason for not offering one.'
  );
  await checkExportDialog('Hangar Link export without pledge numbers');
  if (captureScreenshots) await captureElement('#exportDialog', 'work-temp-export-compatibility-gate.png');
  await chooseExport({exportPreset:'custom'});
  await evaluate("document.querySelectorAll('[name=exportSection]').forEach(input=>input.checked=false); document.querySelector('#exportForm').dispatchEvent(new Event('change',{bubbles:true}))");
  assert(await evaluate("document.querySelector('#exportDownload').disabled && document.querySelector('#exportMessages').textContent.includes('Choose at least one section')"), 'An empty Custom selection did not show a compact actionable error.');
  await evaluate("document.querySelector('[name=exportSection][value=hangar]').checked=true; document.querySelector('[name=exportSection][value=referrals]').checked=true; document.querySelector('#exportForm').dispatchEvent(new Event('change',"
    + "{bubbles:true}))");
  assert(
    await evaluate("!document.querySelector('#exportDownload').disabled && document.querySelector('#exportInventoryOptions').hidden && !document.querySelector('#exportCustomOptions').hidden"),
    'Custom sections retained a hidden community-format selection.'
  );
  for (const preset of ['hangar-log','billing']) {
    await chooseExport({exportPreset:preset});
    assert(
      await evaluate("!document.querySelector('#exportDownload').disabled && document.querySelector('#exportInventoryOptions').hidden && document.querySelector('#exportReferralOptions').hidden && document.querySelector('#exportCustomOptions').hidden"),
      `${preset}: unrelated controls remain visible or local export is disabled.`
    );
  }
  await chooseExport({exportPreset:'inventory', exportInventoryScope:'both', exportFormat:'native'});
  await evaluate("document.querySelector('#exportClose').click(); document.querySelector('#statusToast').hidden=true");
  await setViewport(1600, 1800);
}

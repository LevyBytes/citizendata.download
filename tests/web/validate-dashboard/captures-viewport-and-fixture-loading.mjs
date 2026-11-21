import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { testDirectory } from "./run-options-and-work-folders.mjs";

export async function captureElement(selector, fileName, maximumHeight = 1200) {
  const modalGeometry = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node.matches('dialog')) return null;
    return {
      viewport: {width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,scrollX,scrollY},
      modal: node.getBoundingClientRect().toJSON(),
      css: {width:getComputedStyle(node).width,maxWidth:getComputedStyle(node).maxWidth},
      controls:[...node.querySelectorAll('button,select,input')].filter(control=>control.getClientRects().length).map(control=>({id:control.id||control.className,rect:control.getBoundingClientRect().toJSON()}))
    };
  })()`);
  if (modalGeometry) {
    // Beyond-viewport element captures can reflow native top-layer dialogs
    // after computing their clip. Capture the unchanged viewport instead.
    const layout = await command('Page.getLayoutMetrics');
    const capture = await command('Page.captureScreenshot', {format:'png',captureBeyondViewport:false,fromSurface:true});
    const bytes = Buffer.from(capture.data, 'base64');
    assert(bytes.readUInt32BE(16)===modalGeometry.viewport.width && bytes.readUInt32BE(20)===modalGeometry.viewport.height, 'Modal screenshot did not retain the actual viewport dimensions.');
    await writeFile(path.join(testDirectory,fileName),bytes);
    await writeFile(path.join(testDirectory,fileName.replace(/\.png$/u,'-geometry.json')),`${JSON.stringify({...modalGeometry,layout},null,2)}\n`);
    return;
  }
  const clip = await evaluate(`(()=>{const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:rect.left+scrollX,y:rect.top+scrollY,width:rect.width,height:Math.min(rect.height,${maximumHeight})}})()`);
  const capture = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip: { ...clip, scale: 1 } });
  await writeFile(path.join(testDirectory, fileName), Buffer.from(capture.data, "base64"));
}

export async function captureSupportRow(fileName) {
  const clip = await evaluate(`(() => {
    const rects = ['#projectSupport', '.offline-detail'].map(selector => document.querySelector(selector).getBoundingClientRect());
    const left = Math.min(...rects.map(rect => rect.left));
    const top = Math.min(...rects.map(rect => rect.top));
    return {x:left+scrollX, y:top+scrollY, width:Math.max(...rects.map(rect=>rect.right))-left, height:Math.max(...rects.map(rect=>rect.bottom))-top};
  })()`);
  const capture = await command("Page.captureScreenshot", { format:"png", captureBeyondViewport:true, fromSurface:true, clip:{...clip, scale:1} });
  await writeFile(path.join(testDirectory, fileName), Buffer.from(capture.data, "base64"));
}

export async function setViewport(width, height = 1000) {
  await command("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false });
  await waitFor(`window.innerWidth===${width} && window.innerHeight===${height}`);
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
}

export async function loadFixture(fileName, mutation = "") {
  await evaluate(`(async () => {
    const documentCopy = structuredClone(window.CITIZENDATA_DEMO_DATA);
    ${mutation}
    const stampedDocument = await window.CitizenDataAccountDocument.stampIntegrity(documentCopy);
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(stampedDocument)], ${JSON.stringify(fileName)}, {type:'application/json'}));
    const input = document.querySelector('#jsonFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor("document.querySelector('#messageDialog').open");
  const fixtureResult = await evaluate(`({
    exported:document.querySelector('#railExported').textContent,
    heading:document.querySelector('#messageDialog h2').textContent,
    detail:document.querySelector('#messageDialog p').textContent,
    buildLabel:document.querySelector('#buildButtonLabel').textContent
  })`);
  assert(
    fixtureResult.exported === fileName && fixtureResult.heading === "Account file verified" && fixtureResult.buildLabel === "Build",
    `${fileName}: canonical fixture was rejected or did not retain the Build chooser: ${fixtureResult.heading}: ${fixtureResult.detail}`
  );
  await evaluate("document.querySelector('#messageDialog').close()");
}

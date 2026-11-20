import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { command, evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { captureScreenshots, testDirectory } from "./run-options-and-work-folders.mjs";
import { checkSubscriptionMutationFixtures } from "./subscription-mutation-fixtures-check.mjs";
import { checkUnstatedTotalsPartialHistoryAndLayoutAtWidths } from "./subscription-unstated-totals-and-layout-check.mjs";

export async function checkSubscriptionTier(tier, amount, color) {
  assert(await evaluate(`(() => {
    return document.querySelector('#subscriptionTier').textContent === ${JSON.stringify(tier)}
      && document.querySelector('#subscriptionSpent').textContent === ${JSON.stringify(amount)}
      && document.querySelector('#subscriptionDetailSpent').textContent === ${JSON.stringify(`${amount} USD`)}
      && ['subscriptionSummaryIcon','subscriptionStatusIcon'].every(id => {
        const icon=document.getElementById(id);
        const style=getComputedStyle(icon);
        return !icon.hidden && style.color === ${JSON.stringify(color)} && icon.querySelector('svg path') !== null;
      });
  })()`), `${tier} subscription tier, exact total, or approved icon color is incorrect.`);
  for (const id of ['subscriptionSummaryIcon','subscriptionStatusIcon']) {
    const originalScroll = await evaluate('({x:scrollX,y:scrollY})');
    try {
      await evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center',behavior:'instant'})`);
      const clip = await evaluate(`(() => {const rect=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:rect.left+scrollX,y:rect.top+scrollY,width:rect.width,height:rect.height,scale:1};})()`);
      const screenshot = await command('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,fromSurface:true,clip});
      // Decode the browser's own screenshot in a detached canvas. A computed
      // color alone cannot catch an SVG/mask that reserves space but paints nothing.
      const painted = await evaluate(`(async () => {
        const image=new Image();
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Could not decode icon screenshot'));image.src=${JSON.stringify(`data:image/png;base64,${screenshot.data}`)};});
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
        const expected=${JSON.stringify(color.match(/\d+/gu).map(Number))};
        let matching=0;
        for(let index=0;index<pixels.length;index+=4)if(pixels[index+3]>240&&expected.every((value,channel)=>Math.abs(pixels[index+channel]-value)<=4))matching++;
        return {matching,total:canvas.width*canvas.height};
      })()`);
      if (captureScreenshots) await writeFile(path.join(testDirectory,`work-temp-subscription-icon-${tier.toLowerCase()}-${id}.png`),Buffer.from(screenshot.data,'base64'));
      assert(painted.matching>=10 && painted.matching<painted.total*.8, `${tier} ${id} did not visibly paint the subscriber glyph in its approved color: ${JSON.stringify(painted)}.`);
    } finally {
      await evaluate(`window.scrollTo({left:${originalScroll.x},top:${originalScroll.y},behavior:'instant'})`);
    }
  }
}

export async function checkSubscriptionFixtures() {
  await checkSubscriptionMutationFixtures();
  return checkUnstatedTotalsPartialHistoryAndLayoutAtWidths();
}

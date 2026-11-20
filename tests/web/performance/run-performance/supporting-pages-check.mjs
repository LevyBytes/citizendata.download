import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, out, report, source } from "./options-report-and-asset-inventory.mjs";

export async function checkSupportingPages(session) {
  report.geometry = [];
  for (const width of [320, 768, 1440]) {
    await session.command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await session.evaluate("document.querySelector('#projectSupport').scrollIntoView({ behavior:'instant',block:'center' })");
    const result = await session.evaluate(`(() => { const support=document.querySelector('#projectSupport').getBoundingClientRect(),exportCard=document.querySelector('#exportData').getBoundingClientRect();return `
      + `{pageOverflow:document.documentElement.scrollWidth>innerWidth+1,support:support.toJSON(),exportCard:exportCard.toJSON(),overlap:Math.min(support.right,exportCard.right)>Math.max(support.left,exportCard.left)+1&&Math.min(support.bottom,`
      + `exportCard.bottom)>Math.max(support.top,exportCard.top)+1}; })()`);
    assert(!result.pageOverflow && !result.overlap, `Support/export panels fail layout at ${width}px`);
    report.geometry.push({ page:'dashboard-support',width,...result });
  }
  for (const page of ['privacy-policy.html','terms-of-service.html']) {
    for (const width of [320,768,1440]) {
      await session.command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      await session.command('Page.navigate',{url:pathToFileURL(path.join(source,page)).href});
      await session.until("document.readyState === 'complete'");await session.evaluate('document.fonts.ready.then(()=>true)');
      for(const scale of [1,2]) {
        if(scale===2)await session.evaluate(`(() => {const nodes=[...document.querySelectorAll('h1,h2,h3,p,a,li,dt,dd,span,strong,small')];const sizes=nodes.map(node=>({node,size:parseFloat(getComputedStyle(node).fontSize)}));for(const {node,size} of `
          + `sizes)node.style.fontSize=size*2+'px';})()`);
        await session.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const result=await session.evaluate(`(() => {const clipped=[];for(const node of document.querySelectorAll('h1,h2,h3,p,a,li,dt,dd,header,footer')){if(!node.getClientRects().length)continue;const box=node.getBoundingClientRect();if(box.left < -1 || `
          + `box.right>innerWidth+1 || (node.clientWidth>0&&node.scrollWidth>node.clientWidth+1))clipped.push(node.id||node.localName);}return {pageOverflow:document.documentElement.scrollWidth>innerWidth+1,clipped:[...new Set(clipped)]};})()`);
        report.geometry.push({page,width,textScale:scale,...result});
        assert(!result.pageOverflow&&!result.clipped.length,`${page} ${width}px ${scale*100}% text overflows`);
        if(scale===1&&[320,1440].includes(width)){const image=await session.command(
          'Page.captureScreenshot', {format:'png',captureBeyondViewport:false,fromSurface:true}
        );await writeFile(path.join(out,`${path.basename(page,'.html')}-${width}.png`),Buffer.from(image.data,'base64'));}
      }
    }
  }
}

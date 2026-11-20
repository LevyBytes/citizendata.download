import { assert, openBuildChooser, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkCompleteImageDownloadAndSavingAgain } from "./image-download-complete-check.mjs";
import { checkImageZipWithLaterBuildsAndOtherAccounts } from "./image-zip-with-later-builds-check.mjs";
import { quiet } from "./polling-intervals.mjs";

async function checkCancelledImageDownloadStartsNothingMore() {
  await reloadDashboard();
  const withImages = `
    documentCopy.account.handle='ImageCitizen';documentCopy.profile.handle='ImageCitizen';
    const image=(name)=>({imageKey:name.padEnd(64,'0'),normalizationVersion:1,role:'pledge',url:'https://media.robertsspaceindustries.com/synthetic/'+name+'.png',altText:name,width:null,height:null,mimeTypeHint:null});
    documentCopy.pledges.forEach((pledge,index)=>{pledge.images=[image('a'+index),image('b'+index)];for(const item of pledge.items??[])item.images=[];});
    for(const buyback of documentCopy.buybacks){buyback.images=[];for(const item of buyback.items??[])item.images=[];}
  `;
  await loadFixture('image-download-fixture.json', withImages);
  await waitFor("/^[0-9]+ unique images$/u.test(document.getElementById('mediaSummary').textContent)");
  const planned = await evaluate("Number(document.getElementById('mediaSummary').textContent.split(' ')[0])");
  assert(planned >= 6, `The image plan did not find the fixture's images: ${planned}`);
  // A 1 by 1 PNG, distinct for each address so no two images share content. Each answer takes longer than the gap
  // between two starts, so several are on their way at once.
  await evaluate(`(()=>{
    const png=(seed)=>{const base=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg='
      + '='),c=>c.charCodeAt(0));const text=new TextEncoder().encode(seed);const out=new Uint8Array(base.length+text.length);out.set(base);out.set(text,base.length);return out;};
    window.__images={requests:[],active:0,peak:0,hold:false,release:null,downloads:[]};
    const real=window.fetch.bind(window);
    window.fetch=(url,options={})=>{
      const address=new URL(String(url),location.href);
      if(!['media.robertsspaceindustries.com','robertsspaceindustries.com'].includes(address.hostname))return real(url,options);
      window.__images.requests.push({url:address.href,credentials:options.credentials??null,redirect:options.redirect??null,referrerPolicy:options.referrerPolicy??null,mode:options.mode??null,cache:options.cache??null});
      window.__images.active+=1;window.__images.peak=Math.max(window.__images.peak,window.__images.active);
      if(options.signal?.aborted)return Promise.reject(new DOMException('The download was cancelled.','AbortError'));
      return new Promise((resolve,reject)=>{
        const finish=()=>{window.__images.active-=1;resolve(new Response(png(address.pathname),{status:200,headers:{'content-type':'image/png'}}));};
        options.signal?.addEventListener('abort',()=>{window.__images.active-=1;reject(new DOMException('The download was cancelled.','AbortError'));});
        if(window.__images.hold)window.__images.release=finish;else setTimeout(finish,300);
      });
    };
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download)window.__images.downloads.push(this.download);else click.call(this);};
    return true;
  })()`);
  await openBuildChooser();
  assert(await evaluate("!document.getElementById('buildImagesAction').disabled"), "The image download was not offered for an account with image links.");

  // Cancelled while the first image is still on its way: nothing is packed.
  await evaluate("window.__images.hold=true;document.getElementById('buildImagesAction').click()");
  await waitFor("window.__images.requests.length>=1 && !document.getElementById('mediaCancelOverlay').hidden && document.getElementById('overlaySummary').textContent==='DOWNLOADING'");
  await evaluate("document.getElementById('mediaCancelOverlay').click()");
  await waitFor("document.getElementById('overlaySummary').textContent==='CANCELLED'");
  const cancelled = await evaluate("({status:document.getElementById('mediaStatus').textContent,cancelHidden:document.getElementById('mediaCancelOverlay').hidden,saveHidden:document.getElementById('mediaSaveOverlay').hidden,"
    + "downloads:window.__images.downloads.length,loaded:!document.getElementById('mediaZipLoadedState').hidden})");
  assert(
    cancelled.status === "Image download cancelled. No partial ZIP was created." && cancelled.cancelHidden && cancelled.saveHidden && cancelled.downloads === 0 && !cancelled.loaded,
    `A cancelled image download left something behind: ${JSON.stringify(cancelled)}`
  );
  // Requests that were waiting their turn when the download was cancelled are never started.
  const startedAtCancel = await evaluate("window.__images.requests.length");
  // Longer than the 200 ms the dashboard leaves at most between two starts.
  await quiet(300);
  assert(await evaluate("window.__images.requests.length") === startedAtCancel, `Image requests were started after the download was cancelled: ${startedAtCancel} at the cancel, ${await evaluate("window.__images.requests.length")} later`);
  return { withImages, planned };
}

// The image download from Build: public images are fetched without credentials, a few at a time, packed into one ZIP
// that is saved and opened, and a download in progress can be cancelled. The two RSI image hosts are answered by a
// stand-in inside the page, so nothing leaves the machine.
export async function checkImageDownload() {
  const shared = {};
  Object.assign(shared, await checkCancelledImageDownloadStartsNothingMore());
  await checkCompleteImageDownloadAndSavingAgain(shared);
  return checkImageZipWithLaterBuildsAndOtherAccounts(shared);
}

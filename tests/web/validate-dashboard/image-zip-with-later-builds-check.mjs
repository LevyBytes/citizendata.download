import { chooseAccount } from "./accountswitchmenustate.mjs";
import { assert, openBuildChooser, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

export async function checkImageZipWithLaterBuildsAndOtherAccounts({ withImages, planned }) {
  // The saved ZIP opens with a later build of the same account. The extension draws a new local identifier when it
  // holds no earlier build, so that build carries another identifier and the same handle.
  const zip = await evaluate("({name:window.__images.picked.name,base64:window.__images.picked.base64})");
  const openZip = async () => {
    await evaluate(`(()=>{
      const binary=atob(${JSON.stringify(zip.base64)});const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);
      const transfer=new DataTransfer();transfer.items.add(new File([bytes],${JSON.stringify(zip.name)},{type:'application/zip'}));
      const input=document.getElementById('mediaZipInput');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;
    })()`);
    await waitFor("document.getElementById('messageDialog').open");
    const result = await evaluate("({title:document.getElementById('dialogTitle').textContent,message:document.getElementById('dialogMessage').textContent,fileStatus:document.getElementById('imageFileStatus').textContent,"
      + "loaded:!document.getElementById('mediaZipLoadedState').hidden})");
    await evaluate("document.getElementById('messageDialog').close()");
    return result;
  };
  await reloadDashboard();
  await loadFixture('image-download-rebuilt-fixture.json', `${withImages}documentCopy.account.localAccountId='00000000-0000-4000-8000-0000000000aa';`);
  const reopened = await openZip();
  assert(reopened.title === "Image package verified" && reopened.fileStatus === zip.name && reopened.loaded, `An Images ZIP was refused for a later build of the same account: ${JSON.stringify(reopened)}`);
  // With the ZIP open, a build result of the same account under yet another identifier keeps it open.
  await loadFixture('image-download-rebuilt-again-fixture.json', `${withImages}documentCopy.account.localAccountId='00000000-0000-4000-8000-0000000000bb';documentCopy.pledges[0].images.push(image('c0'));`);
  assert(await evaluate(`document.getElementById('imageFileStatus').textContent===${JSON.stringify(zip.name)} && !document.getElementById('mediaZipLoadedState').hidden`), "Opening a later build of the same account closed the open Images ZIP.");
  // That build has one image the ZIP does not hold. The plan is made again for it, and the next image download
  // fetches that one image and writes a ZIP that names the build now open.
  await waitFor(`document.getElementById('mediaSummary').textContent==='${planned + 1} unique images'`);
  await evaluate(`(()=>{
    const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
    window.__later={requests:[],downloads:[]};
    const real=window.fetch.bind(window);
    window.fetch=(url,options={})=>{
      const address=new URL(String(url),location.href);
      if(!['media.robertsspaceindustries.com','robertsspaceindustries.com'].includes(address.hostname))return real(url,options);
      window.__later.requests.push(address.pathname);
      return Promise.resolve(new Response(png,{status:200,headers:{'content-type':'image/png'}}));
    };
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download)window.__later.downloads.push(this.download);else click.call(this);};
    return true;
  })()`);
  await openBuildChooser();
  await evaluate("document.getElementById('buildImagesAction').click()");
  await waitFor("document.getElementById('overlaySummary').textContent==='COMPLETED'", 30000);
  const later = await evaluate("({requests:window.__later.requests,downloads:window.__later.downloads.length,health:document.getElementById('healthMedia').textContent})");
  assert(
    later.requests.length === 1 && later.requests[0].endsWith('/c0.png') && later.downloads === 1 && later.health.startsWith(`${planned + 1} packaged images loaded`),
    `The image download after a later build did not fetch that build's new image alone: ${JSON.stringify(later)}`
  );
  // Another account opened beside it shows no Images ZIP and refuses this one, which stays open for its own account.
  const ownZip = await evaluate("document.getElementById('imageFileStatus').textContent");
  await loadFixture('image-download-other-account-fixture.json', `${withImages}documentCopy.account.handle='SomeoneElse';documentCopy.profile.handle='SomeoneElse';documentCopy.account.localAccountId='00000000-0000-4000-8000-0000000000cc';`);
  const other = await evaluate("document.getElementById('imageFileStatus').textContent");
  const refused = await openZip();
  assert(other === "No Images ZIP loaded" && refused.title === "Package rejected" && refused.message === "This Images ZIP belongs to a different Account JSON." && refused.fileStatus === "No Images ZIP loaded",
    `An Images ZIP of another account was shown or not refused: ${JSON.stringify({ other, refused })}`);
  await chooseAccount("ImageCitizen");
  const back = await evaluate("({file:document.getElementById('imageFileStatus').textContent,loaded:!document.getElementById('mediaZipLoadedState').hidden})");
  assert(back.file === ownZip && ownZip.endsWith(".zip") && back.loaded, `The account's own Images ZIP was not shown again with it: ${JSON.stringify({ ownZip, back })}`);
}

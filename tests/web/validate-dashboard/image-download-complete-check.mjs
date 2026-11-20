import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";

export async function checkCompleteImageDownloadAndSavingAgain({ planned }) {
  // Run to the end: every planned image once, at most four at a time, no credentials, redirects, or referrer.
  await evaluate("window.__images.hold=false;window.__images.requests=[];window.__images.peak=0;document.getElementById('buildButton').click()");
  await waitFor("!document.getElementById('buildChoices').hidden");
  await evaluate("(()=>{const detail=document.getElementById('overlayDetail');window.__images.details=[];new MutationObserver(()=>{if(document.getElementById('overlaySummary').textContent==='DOWNLOADING')window.__images.details.push(detail.textContent);})"
    + ".observe(detail,{childList:true,characterData:true,subtree:true});return true})()");
  await evaluate("document.getElementById('buildImagesAction').click()");
  await waitFor("document.getElementById('overlaySummary').textContent==='COMPLETED'", 30000);
  // While images download, the sentence under the heading keeps one structure; only its numbers change.
  const details = await evaluate("window.__images.details");
  const progressLines = details.filter((line) => !/^Downloading [0-9,]+ public images\.$/u.test(line));
  assert(
    progressLines.length >= planned && progressLines.every((line) => new RegExp(`^[0-9,]+ of ${planned} images finished\\. [0-4] of 4 requests active\\.$`, "u").test(line)),
    `The image progress sentence changed its structure: ${JSON.stringify([...new Set(details.map((line) => line.replace(/[0-9]+/gu, "N")))])}`
  );
  const finished = await evaluate("({requests:window.__images.requests,peak:window.__images.peak,downloads:window.__images.downloads,status:document.getElementById('mediaStatus').textContent,loaded:!document.getElementById('mediaZipLoadedState').hidden,"
    + "fileStatus:document.getElementById('imageFileStatus').textContent,saveHidden:document.getElementById('mediaSaveOverlay').hidden,saveText:document.getElementById('mediaSaveOverlay').textContent,health:document.getElementById('healthMedia')"
    + ".textContent})");
  assert(finished.requests.length === planned && new Set(finished.requests.map((request) => request.url)).size === planned, `The download did not ask for each planned image once: ${finished.requests.length} requests for ${planned} images`);
  assert(
    finished.requests.every((request) => request.credentials === "omit" && request.redirect === "manual" && request.referrerPolicy === "no-referrer" && request.mode === "cors" && request.cache === "no-store"),
    `An image request carried credentials, followed redirects, or sent a referrer: ${JSON.stringify(finished.requests[0])}`
  );
  assert(finished.peak >= 2 && finished.peak <= 4, `Images were not downloaded a few at a time (most at once: ${finished.peak}).`);
  assert(finished.downloads.length === 1 && /^citizendata-.*\.zip$/u.test(finished.downloads[0]) && finished.status.includes(finished.downloads[0]) && finished.status.includes("All images completed.") && finished.loaded
    && finished.fileStatus === finished.downloads[0] && !finished.saveHidden && finished.saveText === "Save image ZIP again" && finished.health.startsWith(`${planned} packaged images loaded`),
    `The finished image ZIP was not saved and opened: ${JSON.stringify({ ...finished, requests: undefined })}`);
  // Build offers the finished download again without starting another.
  await evaluate("document.getElementById('buildButton').click()");
  await waitFor("!document.getElementById('buildChoices').hidden");
  await evaluate("document.getElementById('buildImagesAction').click()");
  await quiet();
  assert(await evaluate(`window.__images.requests.length===${planned} && !document.getElementById('mediaSaveOverlay').hidden`), "Choosing images again started a second download.");
  // Saving it again writes the same ZIP to the place the user picks.
  await evaluate("window.showSaveFilePicker=async(options)=>{window.__images.picked={name:options.suggestedName,bytes:0};return {createWritable:async()=>({write:async(data)=>{window.__images.picked.bytes=data.byteLength;const bytes=new Uint8Array(await "
    + "new Blob([data]).arrayBuffer());let binary='';for(let start=0;start<bytes.length;start+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(start,start+0x8000));window.__images.picked.base64=btoa(binary);},close:async()=>{}})};};"
    + "document.getElementById('mediaSaveOverlay').click()");
  await waitFor("document.getElementById('mediaStatus').textContent.endsWith('was saved to the selected location.')");
  const savedAgain = await evaluate("({picked:window.__images.picked,downloads:window.__images.downloads,requests:window.__images.requests.length})");
  assert(savedAgain.picked.name === savedAgain.downloads[0] && savedAgain.picked.bytes > 0 && savedAgain.downloads.length === 1 && savedAgain.requests === planned, `Saving the image ZIP again did not write the prepared ZIP: ${JSON.stringify(savedAgain)}`);
}

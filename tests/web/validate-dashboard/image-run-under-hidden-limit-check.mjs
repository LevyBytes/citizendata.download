import { assert, openBuildChooser, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

// The image run under a limit CORS hides from the page (PARSER_HARDENING.md §14, §15.5). RSI's image host answers 429
// without a cross-site header, so the page sees only a TypeError. From the third request every request rejects that
// way, until the control image, asked again for the last image that downloaded, has been refused too. The run brakes,
// once for each image refused with the control (§14: each refused attempt is a refusal): the caution tape shows, no
// image request starts while the wait lasts, and the run completes once the limit has lifted, with every image in
// the ZIP. While the warning shows, a timer of one cache period waits for the next status check; the run's end cancels it.
export async function checkImageRunUnderHiddenLimit({ withImages, planned }) {
  await reloadDashboard();
  await loadFixture("image-download-hidden-limit-fixture.json", withImages);
  await waitFor(`document.getElementById('mediaSummary').textContent==='${planned} unique images'`);
  await evaluate(`(()=>{
    const png=(seed)=>{const base=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg='
      + '='),c=>c.charCodeAt(0));const text=new TextEncoder().encode(seed);const out=new Uint8Array(base.length+text.length);out.set(base);out.set(text,base.length);return out;};
    window.__hidden={requests:[],answered:[],rejected:0,limitFrom:3,limited:false,controlRefused:false,downloads:[],tape:[],statusTimers:new Map()};
    const setTimer=window.setTimeout.bind(window);const clearTimer=window.clearTimeout.bind(window);
    window.setTimeout=(callback,delay,...rest)=>{const statusTimer=delay>=250000&&delay<=300000;let id;
      id=setTimer((...values)=>{if(statusTimer)window.__hidden.statusTimers.set(id,'fired');callback(...values);},delay,...rest);
      if(statusTimer)window.__hidden.statusTimers.set(id,'set');return id;};
    window.clearTimeout=(id)=>{if(window.__hidden.statusTimers.get(id)==='set')window.__hidden.statusTimers.set(id,'cancelled');clearTimer(id);};
    const real=window.fetch.bind(window);
    window.fetch=(url,options={})=>{
      const address=new URL(String(url),location.href);
      if(!['media.robertsspaceindustries.com','robertsspaceindustries.com'].includes(address.hostname))return real(url,options);
      const at=performance.now();
      window.__hidden.requests.push({url:address.href,at});
      if(window.__hidden.requests.length===window.__hidden.limitFrom)window.__hidden.limited=true;
      const limited=window.__hidden.limited;
      // The control image is an address that has already answered; its refusal is the limit's last.
      if(limited&&window.__hidden.answered.includes(address.href)){window.__hidden.limited=false;window.__hidden.controlRefused=true;}
      return new Promise((resolve,reject)=>{
        if(limited)setTimeout(()=>{window.__hidden.rejected+=1;reject(new TypeError('Failed to fetch'));},50);
        else setTimeout(()=>{window.__hidden.answered.push(address.href);resolve(new Response(png(address.pathname),{status:200,headers:{'content-type':'image/png'}}));},300);
      });
    };
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download)window.__hidden.downloads.push(this.download);else click.call(this);};
    const tape=document.getElementById('cautionTape');const tapeText=document.getElementById('cautionTapeText');
    new MutationObserver(()=>{const active=tape.classList.contains('is-active');const last=window.__hidden.tape.at(-1);
      if(!last||last.active!==active||last.text!==tapeText.textContent)window.__hidden.tape.push({at:performance.now(),active,text:tapeText.textContent});})
      .observe(tape,{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});
    return true;
  })()`);
  await openBuildChooser();
  await evaluate("document.getElementById('buildImagesAction').click()");
  // Up to four images are refused with the control, each doubling the factor; the waits and the slower starts after
  // them take up to about a minute.
  await waitFor("document.getElementById('overlaySummary').textContent==='COMPLETED'", 120000);
  const run = await evaluate("({requests:window.__hidden.requests,answered:window.__hidden.answered,rejected:window.__hidden.rejected,controlRefused:window.__hidden.controlRefused,downloads:window.__hidden.downloads,tape:window.__hidden.tape,"
    + "tapeActive:document.getElementById('cautionTape').classList.contains('is-active'),tapeText:document.getElementById('cautionTapeText').textContent,status:document.getElementById('mediaStatus').textContent,"
    + "health:document.getElementById('healthMedia').textContent,statusTimers:[...window.__hidden.statusTimers.values()]})");
  assert(run.controlRefused && run.rejected >= 2, `The hidden limit did not refuse an image and the control image: ${JSON.stringify({ rejected: run.rejected, controlRefused: run.controlRefused })}`);
  // The run braked: the tape showed the limit's warning (W-1), and it is gone once the run has ended.
  const braked = run.tape.find((entry) => entry.active);
  assert(braked?.text === "Potential website issue or rate limiting. Slowing down.", `The caution tape did not show while the image run braked: ${JSON.stringify(run.tape)}`);
  assert(!run.tapeActive && run.tapeText === "", `The caution tape stayed after the image run completed: ${JSON.stringify({ active: run.tapeActive, text: run.tapeText })}`);
  // The status timer of the warning was set, and the run's end cancelled the last one (§14).
  assert(run.statusTimers.length > 0 && !run.statusTimers.includes("set"), `The image run's status timer was not set during the warning or not cancelled at its end: ${JSON.stringify(run.statusTimers)}`);
  // The first wait is at least 2.5 seconds, half of the first 5 (§6.4, rule 6). A start already past the gate when the
  // refusal landed may follow it within a few milliseconds.
  const early = run.requests.filter((request) => request.at > braked.at + 20 && request.at < braked.at + 2400);
  assert(early.length === 0, `An image request started while the run waited out the limit: ${JSON.stringify(early.map((request) => Math.round(request.at - braked.at)))} ms after the brake`);
  // Once the limit lifted every refused image was asked again and downloaded, and the ZIP holds all of them.
  assert(new Set(run.answered).size === planned, `Not every image downloaded after the limit lifted: ${new Set(run.answered).size} of ${planned}`);
  assert(run.downloads.length === 1 && run.status.includes("All images completed.") && run.health.startsWith(`${planned} packaged images loaded`),
    `The image run under a hidden limit did not finish its ZIP: ${JSON.stringify({ ...run, requests: run.requests.length, answered: run.answered.length, tape: undefined })}`);
}

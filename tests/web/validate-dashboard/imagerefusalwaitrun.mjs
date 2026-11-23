import { extensionMessage } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

// An image run that RSI refuses with three images left (a stand-in answers for the image host): the images before
// them download, and each request after them is refused with a wait of ten minutes. Every run's callbacks are kept,
// so a check can call those of a run that has ended.
export const withImages = `
  documentCopy.account.handle='WaitCitizen';documentCopy.profile.handle='WaitCitizen';
  const image=(name)=>({imageKey:name.padEnd(64,'0'),normalizationVersion:1,role:'pledge',url:'https://media.robertsspaceindustries.com/synthetic/'+name+'.png',altText:name,width:null,height:null,mimeTypeHint:null});
  documentCopy.pledges.forEach((pledge,index)=>{pledge.images=[image('c'+index),image('d'+index)];for(const item of pledge.items??[])item.images=[];});
  for(const buyback of documentCopy.buybacks){buyback.images=[];for(const item of buyback.items??[])item.images=[];}
`;

export const installRefusingHost = (served) => evaluate(`(()=>{
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
  window.__wait={requests:[],served:new Set(),downloads:0,runs:[]};
  const real=window.fetch.bind(window);
  window.fetch=(url,options={})=>{
    const address=new URL(String(url),location.href);
    if(!['media.robertsspaceindustries.com','robertsspaceindustries.com'].includes(address.hostname))return real(url,options);
    window.__wait.requests.push(address.pathname);
    if(window.__wait.served.has(address.href)||window.__wait.served.size<${served}){
      window.__wait.served.add(address.href);
      return Promise.resolve(new Response(new Uint8Array([...png,...new TextEncoder().encode(address.pathname)]),{status:200,headers:{'content-type':'image/png'}}));
    }
    return Promise.resolve(new Response(null,{status:429,headers:{'retry-after':'600'}}));
  };
  const click=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.download)window.__wait.downloads+=1;else click.call(this);};
  const materializer=window.CitizenDataMediaMaterializer;
  window.CitizenDataMediaMaterializer=Object.freeze({...materializer,materialize:(entries,policy,options)=>{window.__wait.runs.push(options);return materializer.materialize(entries,policy,options);}});
  return true;
})()`);

// A stand-in for the extension that keeps no images and reads no status, so the run is the page's own.
export const connectQuietBridge = () => evaluate(`(()=>{
  const session=crypto.randomUUID(),nonce='w'.repeat(40);
  const send=(type,requestId,payload)=>${extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:2,type,requestId,bridgeSessionId:session,nonce,payload}")};
  const idle={status:'idle',activeJob:null,hasActiveJob:false,controlSessionBound:false,requiresRebind:false,partialAvailable:false,continuable:false};
  window.addEventListener('message',(event)=>{
    const request=event.data;
    if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||request.bridgeSessionId!==session||['BRIDGE_READY','RESPONSE','STATUS','RESULT'].includes(request.type))return;
    send('RESPONSE',request.requestId,request.type==='GET_STATUS'?{ok:true,status:idle}:{ok:false,code:'BUILD_HISTORY_OFF',message:'Build history is off.',status:idle});
  });
  send('BRIDGE_READY',crypto.randomUUID(),{extensionVersion:'0.42.2',capabilities:{buildJson:true}});
  return true;
})()`);

export const PANEL = `(()=>{const busy=document.getElementById('mediaBusy');const cancel=document.getElementById('mediaCancelOverlay');return {
  summary:document.getElementById('overlaySummary').textContent,operation:document.getElementById('overlayState').textContent,detail:document.getElementById('overlayDetail').textContent,
  counting:Boolean(document.querySelector('#overlayDetail time.countdown')),log:[...document.querySelectorAll('#eventLog p')].map(line=>line.lastChild.textContent),
  busy:!busy.hidden&&busy.getClientRects().length>0,turning:getComputedStyle(busy).animationName,said:document.getElementById('mediaBusyStatus').textContent,
  cancel:cancel.hidden?null:cancel.getAttribute('aria-disabled'),save:!document.getElementById('mediaSaveOverlay').hidden,
  status:document.getElementById('mediaStatus').textContent,requests:window.__wait.requests.length,downloads:window.__wait.downloads};})()`;

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { BrowserSession, collectRequestedAssets, pause } from './browser-session.mjs';

const help = 'Usage: node tests/web/performance/check-asset-loading.mjs --out <evidence-directory> [--source <local-docs-directory>] [--browser chrome|edge|<executable>] [--expect-deferred]\nUntimed local CDP request inventory before/after scrolling to '
  + 'the community footer. No network or source writes. Exit 0: pass; 1: check/runtime failure; 2: invalid arguments.';
if(process.argv.includes('--help')){console.log(help);process.exit(0);}
let source,out,browser,deferred;
try{
  const args=parseArgs({options:{out:{type:'string'},source:{type:'string'},browser:{type:'string',default:'chrome'},'expect-deferred':{type:'boolean',default:false}},strict:true}).values;
  if(!args.out)throw new Error('--out is required');
  out=path.resolve(args.out);source=path.resolve(args.source||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..','..','docs'));deferred=args['expect-deferred'];
  if(['chrome','edge'].includes(args.browser)){const root=args.browser==='edge'?process.env['ProgramFiles(x86)']
    ||process.env.ProgramFiles:process.env.ProgramFiles;if(process.platform!=='win32'||!root)throw new Error('Provide an explicit browser executable');browser=path.join(root,
    ...(args.browser==='edge'?['Microsoft','Edge','Application','msedge.exe']:['Google','Chrome','Application','chrome.exe']));}else browser=path.resolve(args.browser);
  if(!(await stat(path.join(source,'index.html'))).isFile()||!(await stat(browser)).isFile())throw new Error('Source/browser unavailable');
}catch(error){console.error(error.message+'\n'+help);process.exit(2);}
await mkdir(out,{recursive:true});
const files=[];
async function inventory(relative=''){for(const item of await readdir(path.join(source,relative),{withFileTypes:true})){const name=path.join(relative,item.name);if(item.isDirectory())await inventory(name);else if(item.isFile())files.push({
  path:name.replaceAll(path.sep,'/'), bytes:(await stat(path.join(source,name))).size
});}}
await inventory();
const report={checkedAt:new Date().toISOString(),source,expectedDeferred:deferred,target:'assets/made-by-the-community.svg',scope:'Untimed local file request inventory; byte sizes are uncompressed local files, not HTTP transfer sizes',failures:[]};
let session;
try{
  session=await BrowserSession.open(browser,out);report.browser=await session.command('Browser.getVersion');
  await session.command('Page.navigate',{url:pathToFileURL(path.join(source,'index.html')).href});
  await session.until("document.readyState==='complete'&&document.querySelectorAll('#inventoryRows tr').length===3");await session.evaluate('document.fonts.ready.then(()=>true)');await pause(1000);
  report.initial=collectRequestedAssets(session.requests,source,files);
  report.initialTargetRequested=report.initial.files.some(item=>item.path===report.target);
  report.imageBefore=await session.evaluate(`(() => {const image=document.querySelector('img[src="assets/made-by-the-community.svg"]');return {loading:image.loading,decoding:image.decoding,widthAttribute:image.getAttribute('width'),`
    + `heightAttribute:image.getAttribute('height'),complete:image.complete,naturalWidth:image.naturalWidth,rect:image.getBoundingClientRect().toJSON(),viewportHeight:innerHeight};})()`);
  if(report.initial.files.length<10)throw new Error('CDP asset inventory is unexpectedly empty');
  if(deferred&&report.initialTargetRequested)throw new Error('Community mark was requested before footer scroll');
  await session.evaluate("document.querySelector('footer').scrollIntoView({behavior:'instant',block:'center'})");
  await session.until("document.querySelector('img[src=\"assets/made-by-the-community.svg\"]').complete&&document.querySelector('img[src=\"assets/made-by-the-community.svg\"]').naturalWidth>0");await pause(100);
  report.afterFooter=collectRequestedAssets(session.requests,source,files);
  report.targetRequestedAfterFooter=report.afterFooter.files.some(item=>item.path===report.target);
  report.imageAfter=await session.evaluate(`(() => {const image=document.querySelector('img[src="assets/made-by-the-community.svg"]');return {loading:image.loading,decoding:image.decoding,widthAttribute:image.getAttribute('width'),`
    + `heightAttribute:image.getAttribute('height'),complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,rect:image.getBoundingClientRect().toJSON()};})()`);
  if(!report.targetRequestedAfterFooter)throw new Error('Footer scroll did not load the community mark');
  if(deferred&&(report.imageAfter.loading!=='lazy'||report.imageAfter.decoding!=='async'||report.imageAfter.widthAttribute!=='1418'||report.imageAfter.heightAttribute!=='1418'))throw new Error('Lazy image attributes or dimensions are incorrect');
  const shot=await session.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});await writeFile(path.join(out,'footer.png'),Buffer.from(shot.data,'base64'));
  report.exceptions=session.exceptions;report.remoteRequests=session.remote;
  if(session.exceptions.length||session.remote.length)throw new Error('Page exception or remote request attempt occurred');
}catch(error){report.failures.push(String(error.stack||error));console.error(error.message);}finally{if(session)try{await session.close();}catch(error){report.failures.push(String(error.stack||error));}}
await writeFile(path.join(out,'asset-loading.json'),JSON.stringify(report,null,2)+'\n');
const message=`${report.failures.length?'FAIL':'PASS'} asset inventory: initial ${report.initial?.files.length??0} files/${report.initial?.bytes??0}B; community mark initially ${report.initialTargetRequested?'requested':'deferred'}; after `
  + `footer ${report.targetRequestedAfterFooter?'loaded':'not loaded'}`;
await writeFile(path.join(out,'run.log'),message+'\n');console.log(message);process.exitCode=report.failures.length?1:0;

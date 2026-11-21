import { pause } from "../browser-session.mjs";
import { assert, report } from "./options-report-and-asset-inventory.mjs";

export async function motionSample(session, label, location) {
  await session.evaluate(`document.querySelector(${JSON.stringify(location)}).scrollIntoView({ behavior:'instant', block:${JSON.stringify(location === '#overview' ? 'center' : 'end')} })`);
  await session.until(`document.querySelector('#overview').dataset.motionState === ${JSON.stringify(location === '#overview' ? 'running' : 'paused')}`);
  const before = await session.metrics(), frameBefore = await session.evaluate('({frames:window.__performanceSample.heroFrames,paints:window.__performanceSample.heroPaints})');
  const start = performance.now(); await pause(2200); const wallSeconds = (performance.now() - start) / 1000;
  const after = await session.metrics(), frameAfter = await session.evaluate('({frames:window.__performanceSample.heroFrames,paints:window.__performanceSample.heroPaints})');
  const row = {
    label, wallSeconds, frames: frameAfter.frames - frameBefore.frames, paints: frameAfter.paints - frameBefore.paints,
    rendererTaskSeconds: after.TaskDuration - before.TaskDuration, scriptSeconds: after.ScriptDuration - before.ScriptDuration,
    layoutSeconds: after.LayoutDuration - before.LayoutDuration, recalcStyleSeconds: after.RecalcStyleDuration - before.RecalcStyleDuration
  };
  row.mainThreadTaskPercentOfWall = row.rendererTaskSeconds / wallSeconds * 100;
  report.motion.push(row);
  assert(location === '#overview' ? row.frames > 20 : row.frames === 0, `Hero frame suspension failed: ${label}`);
}

export async function buildLargeFixture(session) {
  return session.evaluate(`(async () => {
    const fixture = structuredClone(window.CITIZENDATA_DEMO_DATA);
    fixture.account.handle = fixture.profile.handle = fixture.profile.displayName = 'PerformanceCitizen';
    const inventory = (base,count,prefix,state) => Array.from({length:count},
      (_,index) => ({ ...base, recordKey:prefix+'-'+index, title:'Performance '+prefix+' '+String(index).padStart(4,'0'), state, containsSummary:'Bounded synthetic performance record', items:[],images:[] }));
    fixture.pledges = inventory(fixture.pledges[0],1000,'Pledge','current');
    fixture.buybacks = inventory(fixture.buybacks[0],1500,'Buyback','available');
    for(const ladder of ['current','legacy'])for(const kind of ['prospects','recruits']) { const base=fixture.referrals[ladder][kind][0]; fixture.referrals[ladder][kind] = Array.from({length:500},
      (_,index) => ({...base,recordKey:ladder+'-'+kind+'-'+index,displayName:'Performance Person '+index,handle:'PerfPerson'+index,dateRaw:'November 17, 2026',dateSortKey:'2026-11-17',images:[]})); }
    fixture.organizations.memberships = fixture.organizations.memberships.filter(record=>['TEST',
      'MMHC'].includes(record.sid)).map(record => ({...record,name:record.sid==='TEST'?'Performance Main Organization':'Performance Affiliate Organization',memberCount:500,images:[]}));
    fixture.organizations.members = ['TEST',
      'MMHC'].flatMap(sid => { const base=fixture.organizations.members.find(record=>record.organizationSid===sid&&record.visibility==='public'); return Array.from({length:500},
      (_,index) => ({...base,recordKey:sid+'-'+index,displayName:'Performance Member '+index,handle:'PerfMember'+index,images:[]})); });
    fixture.profile.mainOrganizationSid = 'TEST'; fixture.profile.images = [];
    const text = JSON.stringify(await window.CitizenDataAccountDocument.stampIntegrity(fixture));
    window.__largePerformanceJson = text;
    return {bytes:new TextEncoder().encode(text).length,pledges:fixture.pledges.length,buybacks:fixture.buybacks.length,referrals:2000,members:1000,totalRecords:5500,imageFreeCollections:true};
  })()`);
}
export async function importLarge(session, index) {
  const result = await session.evaluate(`(async () => {
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    const transfer = new DataTransfer(); transfer.items.add(new File([window.__largePerformanceJson],'performance-fixture-${index}.json',{type:'application/json'}));
    const input = document.querySelector('#jsonFileInput'); input.files = transfer.files;
    const started = performance.now(), taskStart = window.__performanceSample.longTasks.length;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    while(!(document.querySelector('#railExported').textContent === 'performance-fixture-${index}.json' && document.querySelector('#messageDialog').open)) {
      const dialog=document.querySelector('#messageDialog');
      if(dialog.open&&document.querySelector('#dialogTitle').textContent==='File rejected')throw new Error('Synthetic import rejected: '+document.querySelector('#dialogMessage').textContent);
      if(performance.now()-started>15000)throw new Error('Synthetic import did not complete');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const durationMs = performance.now()-started; document.querySelector('#messageDialog').close();
    return {durationMs,nodes:document.querySelectorAll('*').length,renderedInventoryRows:document.querySelectorAll('#inventoryRows tr').length,longTasks:window.__performanceSample.longTasks.slice(taskStart)};
  })()`);
  // The Hangar table shows its records 100 to a page: all 1000 are listed when its first page holds 100 rows and its
  // page status counts 1,000 records over 10 pages.
  const listed = await session.evaluate("document.querySelector('#inventoryPageStatus').textContent");
  assert(result.renderedInventoryRows === 100 && listed === '1,000 records · page 1 of 10', `Large fixture did not list its 1000 Hangar records: ${result.renderedInventoryRows} rows, "${listed}"`);
  report.interactions.push({ label: 'large-json-import', index, ...result });
}

import { assert, buildChooserState, extensionMessage, openBuildChooser, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkInventoryPagingSearchAndFilters } from "./inventory-paging-search-and-filters-check.mjs";

async function checkDeferredBadgeArtAndSelectionAnnouncement() {
  await reloadDashboard();
  const example = await evaluate(`(()=>{
    const badgeImages=[...document.querySelectorAll('.badge-card img')];
    const closed=badgeImages.filter(image=>image.closest('details:not([open])'));
    const inspector=document.getElementById('recordInspector');
    const announcement=document.getElementById('inspectorAnnouncement');
    return {
      badgeImages:badgeImages.length,eager:badgeImages.filter(image=>image.loading!=='lazy').length,closed:closed.length,closedLoaded:closed.filter(image=>image.naturalWidth>0).length,
      badgeRequests:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/assets/badges/')).length,
      liveInspector:inspector.hasAttribute('aria-live'),inspectorLabel:inspector.getAttribute('aria-label'),
      announcementRole:announcement.getAttribute('role'),announcement:announcement.textContent,announcementVisibleSize:announcement.getBoundingClientRect().width,
      pagination:document.getElementById('inventoryPagination').getClientRects().length>0,count:document.getElementById('resultCount').textContent
    };
  })()`);
  assert(example.badgeImages > 50 && example.eager === 0 && example.closed > 50 && example.closedLoaded === 0 && example.badgeRequests < example.badgeImages - example.closed + 1,
    `Badge artwork inside closed panels was requested before the panel opened: ${JSON.stringify(example)}`);
  assert(!example.liveInspector && example.inspectorLabel === "Selected record details" && example.announcementRole === "status" && example.announcement === "" && example.announcementVisibleSize <= 1,
    `The inspector must not be a live region, and nothing may be announced before a selection: ${JSON.stringify(example)}`);
  assert(!example.pagination && example.count === "3 shown of 3", `A small inventory must look unchanged, with no paging controls: ${JSON.stringify(example)}`);

  await evaluate("document.querySelectorAll('#inventoryRows .record-button')[1].click()");
  const announced = await evaluate("({text:document.getElementById('inspectorAnnouncement').textContent,title:document.getElementById('inspectorTitle').textContent})");
  assert(announced.title.length > 0 && announced.text === `Showing details for ${announced.title}.`, `Selecting a record did not announce exactly one short status line: ${JSON.stringify(announced)}`);
  await evaluate("document.getElementById('recordSearch').value='zzzz-no-match';document.getElementById('recordSearch').dispatchEvent(new Event('input',{bubbles:true}))");
  assert(
    await evaluate(`document.getElementById('inspectorAnnouncement').textContent===${JSON.stringify(`Showing details for ${announced.title}.`)} && !document.getElementById('emptyState').hidden`),
    "Filtering changed the selection announcement without a user selection."
  );
  await evaluate("document.getElementById('recordSearch').value='';document.getElementById('recordSearch').dispatchEvent(new Event('input',{bubbles:true}))");
}

async function checkResultFinishedWithoutADashboard() {
  // A bridge from a different extension release, same protocol, connects normally and delivers a result that finished while no dashboard was open.
  await evaluate(`(async()=>{
    const session=crypto.randomUUID(),nonce='r'.repeat(40);
    const send=(type,requestId,payload)=>${extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:2,type,requestId,bridgeSessionId:session,nonce,payload}")};
    const recovered=structuredClone(window.CITIZENDATA_DEMO_DATA);
    recovered.account.handle='RecoveredCitizen';recovered.profile.handle='RecoveredCitizen';recovered.profile.displayName='Recovered Citizen';
    const result=await window.CitizenDataAccountDocument.stampIntegrity(recovered);
    window.__recovery={requests:[],acknowledged:null};
    const status=()=>({status:'complete',activeJob:null,hasActiveJob:false,controlSessionBound:false,requiresRebind:false,partialAvailable:false,continuable:false,
      completedResultPending:window.__recovery.acknowledged?null:{runId:'run-recovered',jobKind:'accountData'}});
    window.addEventListener('message',(event)=>{
      const request=event.data;
      if(event.source!==window||request?.channel!=='citizendata.dashboard.v1'||request.bridgeSessionId!==session||!['GET_STATUS','GET_COMPLETED_RESULT','ACKNOWLEDGE_RESULT'].includes(request.type))return;
      window.__recovery.requests.push(request.type);
      let payload={ok:true,status:status()};
      if(request.type==='GET_COMPLETED_RESULT') payload={ok:true,runId:'run-recovered',jobKind:'accountData',selectedSections:[],result,status:status()};
      if(request.type==='ACKNOWLEDGE_RESULT'){window.__recovery.acknowledged=request.payload?.runId??null;payload={ok:true,status:status()};}
      send('RESPONSE',request.requestId,payload);
    });
    send('BRIDGE_READY',crypto.randomUUID(),{extensionVersion:'0.99.7',capabilities:{buildJson:true}});
    return true;
  })()`);
  // The page shows another account's file, so the result is put under its own account, without switching to it.
  const shownBefore = await evaluate("document.querySelector('#accountHandle').textContent");
  await waitFor("document.querySelector('#messageDialog').open && window.__recovery.acknowledged==='run-recovered'");
  const recovery = await evaluate("({title:document.querySelector('#dialogTitle').textContent,message:document.querySelector('#dialogMessage').textContent,requests:window.__recovery.requests,summary:document.querySelector('#overlaySummary')"
    + ".textContent,handle:document.querySelector('#accountHandle').textContent,menu:[...document.querySelectorAll('#accountMenuAccounts [role=\"menuitemradio\"]')].map(item=>item.textContent)})");
  assert(recovery.handle === shownBefore && shownBefore !== "RecoveredCitizen" && recovery.menu.some((label) => label.includes("RecoveredCitizen")) && recovery.message.includes("is open under Switch Account"),
    `A result of another account than the one shown switched the page, or was not put under Switch Account: ${JSON.stringify(recovery)}`);
  assert(recovery.title === "Account backup saved" && recovery.message.includes("finished while the dashboard was not connected") && recovery.summary !== "UPDATE REQUIRED"
    && recovery.requests.filter(type => type === "GET_COMPLETED_RESULT").length === 1 && recovery.requests.filter(type => type === "ACKNOWLEDGE_RESULT").length === 1
    && recovery.requests.indexOf("GET_COMPLETED_RESULT") < recovery.requests.indexOf("ACKNOWLEDGE_RESULT"),
  `A waiting completed result was not fetched once, saved, and acknowledged: ${JSON.stringify(recovery)}`);
  await evaluate("document.querySelector('#messageDialog').close()");
  await openBuildChooser();
  const connected = await evaluate(buildChooserState);
  assert(!connected.notice && !connected.link && connected.account && !connected.accountDisabled, `A connected extension from another release still showed the install notice: ${JSON.stringify(connected)}`);
  await evaluate("document.querySelector('#closeOverlay').click()");
}

// Paging, selection announcements, deferred badge art, and recovery of a result that finished without a dashboard.
export async function checkAuditRepairs() {
  await checkDeferredBadgeArtAndSelectionAnnouncement();
  await checkInventoryPagingSearchAndFilters();
  return checkResultFinishedWithoutADashboard();
}

import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";

export async function checkSkipReconnectAndContinueRequests({ controls, sent }) {
  // Skip is offered for one stage only, the reading of CCU buy-back prices, beside Pause and Cancel. It sends its
  // own request once and is then withdrawn for that run.
  const skipShown = "!document.getElementById('skipCollection').hidden&&!document.getElementById('collectionControls').hidden";
  assert(!(await evaluate(skipShown)), "Skip was offered while another stage was read.");
  await evaluate("(()=>{const status=window.__controls.shape('running');status.activeJob.currentSection='buybackUpgradePrices';window.__controls.emit(status);return true})()");
  await waitFor(skipShown);
  const skipping = await evaluate(controls);
  assert(skipping.pause && skipping.cancel && !skipping.resume && await evaluate("document.getElementById('skipCollection').textContent") === "Skip", `The CCU price stage did not offer Pause, Cancel and Skip: ${JSON.stringify(skipping)}`);
  await evaluate("document.getElementById('skipCollection').click()");
  await waitFor(`${sent("SKIP_CCU_PRICES")}===1 && document.getElementById('skipCollection').hidden`);
  await evaluate("window.__controls.emit(structuredClone(window.__controls.status))");
  await quiet();
  assert(await evaluate(`${sent("SKIP_CCU_PRICES")}===1 && document.getElementById('skipCollection').hidden`), "Skip was offered a second time for the same run.");
  await evaluate("window.__controls.emit(window.__controls.shape('running'))");
  await waitFor("!document.getElementById('pauseCollection').hidden && document.getElementById('skipCollection').hidden");

  // A run this page does not control offers only reconnection, and reconnecting is its own request.
  await evaluate("window.__controls.emit(window.__controls.shape('paused',{controlSessionBound:false,requiresRebind:true}))");
  await waitFor("!document.getElementById('rebindCollection').hidden");
  const unbound = await evaluate(controls);
  assert(unbound.rebind && unbound.rebindText === "Reconnect paused run" && !unbound.pause && !unbound.resume && !unbound.cancel, `A run owned by another session offered more than reconnection: ${JSON.stringify(unbound)}`);
  await evaluate("document.getElementById('rebindCollection').click()");
  await waitFor(`${sent("REQUEST_REBIND")}===1 && !document.getElementById('resumeCollection').hidden`);
  await evaluate("document.getElementById('cancelCollection').click()");
  await waitFor(`${sent("CANCEL")}===1 && document.getElementById('cancelCollection').hidden`);

  // A failed run that can be continued turns Resume into Continue backup, which asks for a continuation.
  await evaluate("window.__controls.emit(window.__controls.shape('failed',{continuable:true}))");
  await waitFor("document.getElementById('resumeCollection').textContent==='Continue backup' && !document.getElementById('resumeCollection').hidden");
  await evaluate("document.getElementById('resumeCollection').click()");
  await waitFor(`${sent("CONTINUE_PARTIAL")}===1 && document.getElementById('messageDialog').open`);
  assert(await evaluate("document.getElementById('dialogTitle').textContent==='Continuation declined'"), "A declined continuation was not reported.");
  await evaluate("document.getElementById('messageDialog').close()");
  const afterControls = await evaluate("window.__controls.requests");
  assert(
    JSON.stringify(afterControls) === JSON.stringify(["PAUSE", "RESUME", "SKIP_CCU_PRICES", "REQUEST_REBIND", "CANCEL", "CONTINUE_PARTIAL"].map((type) => ({ type, payload: null }))),
    `The run controls sent something other than one bare request each: ${JSON.stringify(afterControls)}`
  );
}

export async function checkRefusedResultAndRosterRequests({ sent }) {
  // A delivered result that fails the integrity check is refused and the open account stays.
  await evaluate(`(async()=>{
    const tampered=await window.CitizenDataAccountDocument.stampIntegrity(structuredClone(window.CITIZENDATA_DEMO_DATA));
    tampered.account.handle='TamperedCitizen';
    window.__controls.status=window.__controls.shape('idle');
    window.__controls.deliver({status:window.__controls.status,result:tampered});
    return true;
  })()`);
  await waitFor("document.getElementById('messageDialog').open");
  const refused = await evaluate("({title:document.getElementById('dialogTitle').textContent,message:document.getElementById('dialogMessage').textContent,handle:document.getElementById('accountHandle').textContent,"
    + "acknowledged:window.__controls.requests.filter(request=>request.type==='ACKNOWLEDGE_RESULT').length})");
  assert(refused.title === "Extension result rejected" && refused.message.includes("integrity") && refused.handle === "ControlCitizen" && refused.acknowledged === 0, `A tampered result was not refused: ${JSON.stringify(refused)}`);
  await evaluate("document.getElementById('messageDialog').close()");

  // Organization rosters: one checklist, then one request carrying the chosen organization identifiers.
  const memberships = await evaluate("window.CITIZENDATA_DEMO_DATA.organizations.memberships.map(membership=>membership.sid)");
  assert(memberships.length >= 2, "The example account needs two organizations for this check.");
  await evaluate("document.getElementById('buildOrgButton').click()");
  await waitFor("document.getElementById('orgBuildDialog').open");
  const listed = await evaluate("[...document.querySelectorAll('#orgRosterChecklist input[type=checkbox]')].map(input=>input.value)");
  assert(JSON.stringify(listed) === JSON.stringify(memberships), `The checklist did not list the account's organizations: ${JSON.stringify(listed)}`);
  await evaluate(`(()=>{for(const input of document.querySelectorAll('#orgRosterChecklist input[type=checkbox]')){input.checked=input.value===${JSON.stringify(memberships[1])};input.dispatchEvent(new Event('change',{bubbles:true}));`
    + `}document.getElementById('orgBuildForm').requestSubmit();return true})()`);
  await waitFor(`${sent("PROPOSE_ORGANIZATION_ROSTER")}===1 && document.getElementById('messageDialog').open`);
  const roster = await evaluate("({request:window.__controls.requests.at(-1),dialogClosed:!document.getElementById('orgBuildDialog').open,title:document.getElementById('dialogTitle').textContent})");
  assert(
    JSON.stringify(roster.request) === JSON.stringify({ type: "PROPOSE_ORGANIZATION_ROSTER", payload: { organizationSids: [memberships[1]] } }) && roster.dialogClosed && roster.title === "Organization job declined",
    `The organization build did not send the chosen identifier alone: ${JSON.stringify(roster)}`
  );
  await evaluate("document.getElementById('messageDialog').close()");
  // With nothing chosen the plan cannot be started.
  await evaluate("document.getElementById('buildOrgButton').click()");
  await waitFor("document.getElementById('orgBuildDialog').open");
  await evaluate("(()=>{for(const input of document.querySelectorAll('#orgRosterChecklist input[type=checkbox]')){input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}return true})()");
  assert(await evaluate("document.getElementById('orgBuildStart').disabled"), "An organization plan with nothing chosen could be started.");
  await evaluate("document.getElementById('orgBuildCancel').click()");
  assert(await evaluate(`${sent("PROPOSE_ORGANIZATION_ROSTER")}===1 && !document.getElementById('orgBuildDialog').open`), "Cancelling the organization plan sent a request or left the dialog open.");
}

import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";

const continuationState = await evaluate("(()=>{const overlay=document.querySelector('#parserOverlay'),activity=document.querySelector('#collectionActivity'),content=activity.querySelector(':scope > div'),activityWidth=activity.getBoundingClientRect()"
  + ".width;return {summary:document.querySelector('#overlaySummary').textContent,operation:document.querySelector('#overlayOperation').textContent,state:document.querySelector('#overlayState').textContent,detail:document.querySelector('#overlayDetail')"
  + ".textContent,tone:overlay.dataset.tone,overlayHidden:overlay.hidden,overlayMinimized:overlay.classList.contains('minimized'),overlayDisplay:getComputedStyle(overlay).display,overlayWidth:overlay.getBoundingClientRect().width,"
  + "activityHidden:activity.hidden,activityDisplay:getComputedStyle(activity).display,activityWidth,resumeHidden:document.querySelector('#resumeCollection').hidden,resumeText:document.querySelector('#resumeCollection').textContent,"
  + "buildLabel:document.querySelector('#buildButtonLabel').textContent,buildDisabled:document.querySelector('#buildButton').disabled,eventText:document.querySelector('#eventLog').textContent,"
  + "imageHasSource:document.querySelector('#collectionActivityImage').hasAttribute('src'),hasActivityImage:activity.classList.contains('has-activity-image'),columnCount:getComputedStyle(activity).gridTemplateColumns.trim().split(/\\s+/u).length,"
  + "contentRatio:activityWidth?content.getBoundingClientRect().width/activityWidth:null}})()");
assert(continuationState.summary === 'READY TO CONTINUE'
  && continuationState.operation === 'CONTINUE BACKUP'
  && continuationState.state === 'Continue backup from Buybacks'
  && continuationState.detail.includes('Buybacks page 2 cursor are preserved')
  && continuationState.tone === 'warning'
  && !continuationState.resumeHidden
  && continuationState.resumeText === 'Continue backup'
  && continuationState.buildLabel === 'Build'
  && !continuationState.buildDisabled
  && continuationState.eventText.includes('Previous attempt history')
  && continuationState.eventText.includes('requested Buybacks page 2, but RSI returned page 1')
  && continuationState.eventText.includes('Technical detail: RSI_READ_FAILED: RSI_BUYBACKS_PAGE_MISMATCH_REQUESTED_2_OBSERVED_1')
  && !continuationState.imageHasSource
  && !continuationState.hasActivityImage
  && continuationState.columnCount === 1
  && continuationState.contentRatio > .8,
`Continuable partial did not render a preserved ready state, friendly attempt history, one content column, Build chooser, and explicit Continue backup control: ${JSON.stringify(continuationState)}`);
await evaluate("(()=>{const complete=structuredClone(window.__citizendataActiveStatus);complete.status='complete';complete.hasActiveJob=false;complete.activeJob.status='complete';complete.activeJob.sectionIndex=13;"
  + "complete.activeJob.completedSections=13;window.__citizendataTestStatus=complete;window.__emitCitizenDataStatus(complete);return true})()");
await waitFor("document.querySelector('#overlaySummary').textContent==='COMPLETED'");
assert(await evaluate("document.querySelector('#minimizeOverlay') && document.querySelector('#closeOverlay') && !document.querySelector('#parserOverlay').hidden"), "Completed status did not retain separate minimize and close controls.");
await evaluate("document.querySelector('#closeOverlay').click()");
assert(await evaluate("document.querySelector('#parserOverlay').hidden"), "Completed status close control did not hide the panel.");
await evaluate("window.__emitCitizenDataStatus(structuredClone(window.__citizendataTestStatus))");
await quiet();
assert(await evaluate("document.querySelector('#parserOverlay').hidden"), "Polling reopened a completed status panel that the user closed.");
await evaluate("document.querySelector('#buildButton').click()");
await waitFor("!document.querySelector('#parserOverlay').hidden && !document.querySelector('#buildChoices').hidden");
await evaluate("document.querySelector('#buildAccountAction').click()");
await waitFor("!document.querySelector('#parserOverlay').hidden");
assert(await evaluate("!document.querySelector('#parserOverlay').hidden"), "Build chooser account action did not reopen the completed status panel.");
await waitFor("document.querySelector('#messageDialog').open");
await evaluate("document.querySelector('#messageDialog').close();document.querySelector('#parserOverlay').hidden=true");

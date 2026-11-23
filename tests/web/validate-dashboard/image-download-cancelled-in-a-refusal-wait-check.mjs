import { assert, openBuildChooser, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { PANEL, connectQuietBridge, installRefusingHost, withImages } from "./imagerefusalwaitrun.mjs";
import { quiet } from "./polling-intervals.mjs";

// Cancel in the wait RSI's refusal sets, with three images left and no request active: the panel says CANCELLING at
// once, the run ends long before the ten-minute wait would, and nothing more is fetched or saved. The wait is in the
// log, and the busy indicator turns beside Cancel until the run has ended. It is run with no extension and with one.
const REFUSED_WAIT = "[...document.querySelectorAll('#eventLog p')].some(line=>/^Image requests were refused\\. Waiting [0-9]+ seconds before trying again\\.$/u.test(line.lastChild.textContent))";
const CANCEL_LINE = "Cancellation requested. Stopping active requests and waits.";

async function startRefusedRun(planned, runs) {
  await openBuildChooser();
  await evaluate("document.getElementById('buildImagesAction').click()");
  await waitFor(`window.__wait.runs.length===${runs} && ${REFUSED_WAIT}`, 30000);
  const waiting = await evaluate(PANEL);
  assert(waiting.summary === "DOWNLOADING" && waiting.detail.startsWith(`${planned - 3} of ${planned} images finished. 0 of `) && waiting.detail.includes("Image requests were refused. Trying again in ") && waiting.counting
    && waiting.busy && waiting.said === "Image download waiting before retry" && waiting.cancel === null, `The refusal's wait was not shown as a wait of a run still alive: ${JSON.stringify(waiting)}`);
  return waiting;
}

async function cancelInRefusalWait(withBridge) {
  await reloadDashboard();
  await loadFixture(`refusal-wait-${withBridge ? "with-extension" : "without-extension"}.json`, withImages);
  await waitFor("/^[0-9]+ unique images$/u.test(document.getElementById('mediaSummary').textContent)");
  const planned = await evaluate("Number(document.getElementById('mediaSummary').textContent.split(' ')[0])");
  if (withBridge) await connectQuietBridge();
  await installRefusingHost(planned - 3);
  await startRefusedRun(planned, 1);
  // The clicks and the panel are read in one turn: CANCELLING shows before the run has unwound, and a second click adds nothing.
  const clicked = await evaluate(`(()=>{const cancel=document.getElementById('mediaCancelOverlay');cancel.click();cancel.click();return ${PANEL};})()`);
  assert(clicked.summary === "CANCELLING" && clicked.operation === "Cancelling image download" && clicked.log[0] === CANCEL_LINE && clicked.log.filter((line) => line === CANCEL_LINE).length === 1
    && clicked.cancel === "true" && clicked.busy && clicked.said === "Cancelling image download", `Cancel did not show CANCELLING at once, or a second click did more: ${JSON.stringify(clicked)}`);
  await waitFor("document.getElementById('overlaySummary').textContent==='CANCELLED'", 5000);
  await quiet();
  const ended = await evaluate(PANEL);
  assert(ended.operation === "Image download cancelled" && ended.status === "Image download cancelled. No partial ZIP was created." && !ended.busy && ended.said === "" && ended.cancel === null && !ended.counting
    && ended.requests === clicked.requests && ended.downloads === 0, `The cancelled run did not end at once, or fetched or saved more: ${JSON.stringify(ended)}`);
  return planned;
}

async function cancelWhileTheBuiltArchiveIsBeingChecked() {
  await reloadDashboard();
  await loadFixture("cancel-during-archive-check.json", withImages);
  await waitFor("/^[0-9]+ unique images$/u.test(document.getElementById('mediaSummary').textContent)");
  const planned = await evaluate("Number(document.getElementById('mediaSummary').textContent.split(' ')[0])");
  await installRefusingHost(planned);
  await evaluate(`(()=>{const reader=window.CitizenDataMediaPackageReader;window.__archiveCheck={entered:false,release:null};
    window.CitizenDataMediaPackageReader=Object.freeze({...reader,open:(...args)=>{window.__archiveCheck.entered=true;
      return new Promise((resolve,reject)=>{window.__archiveCheck.release=()=>reader.open(...args).then(resolve,reject);});}});return true;})()`);
  await openBuildChooser();
  await evaluate("document.getElementById('buildImagesAction').click()");
  await waitFor("window.__archiveCheck.entered===true", 30000);
  const clicked = await evaluate(`(()=>{document.getElementById('mediaCancelOverlay').click();return ${PANEL};})()`);
  assert(clicked.summary === "CANCELLING" && !clicked.save && clicked.downloads === 0,
    `Cancel during the archive check exposed a package before the run ended: ${JSON.stringify(clicked)}`);
  await evaluate("window.__archiveCheck.release()");
  await waitFor("document.getElementById('overlaySummary').textContent==='CANCELLED'", 5000);
  const ended = await evaluate(PANEL);
  assert(!ended.save && ended.downloads === 0 && ended.status === "Image download cancelled. No partial ZIP was created.",
    `Cancel during the archive check left a package or download behind: ${JSON.stringify(ended)}`);
  await evaluate("document.getElementById('closeOverlay').click()");
}

export async function checkImageDownloadCancelledInARefusalWait() {
  await cancelInRefusalWait(true);
  const planned = await cancelInRefusalWait(false);
  // A new run can start, and the ended run's callbacks, called while it waits, change nothing in it.
  await startRefusedRun(planned, 2);
  const before = await evaluate(PANEL);
  await evaluate(`(()=>{const ended=window.__wait.runs[0];ended.onRequestStart({index:0,total:9,attempt:1,activeRequests:4,maximumConcurrency:4});
    ended.onProgress({completed:9,total:9,receipt:{status:'downloaded'},activeRequests:4,pace:{warning:null,waitingUntil:null,factor:1,statusPage:null}});
    ended.onWait({phase:'resumed',reason:'rate-limit',waitMs:1,waitingUntil:new Date().toISOString(),factor:1,imageIndex:0,attempt:1});return true;})()`);
  const after = await evaluate(PANEL);
  const withoutTime = (detail) => detail.replace(/[0-9]+:[0-9]{2}/u, "");
  assert(JSON.stringify(after.log) === JSON.stringify(before.log) && after.summary === "DOWNLOADING" && withoutTime(after.detail) === withoutTime(before.detail) && after.said === before.said,
    `A callback of the cancelled run changed the next run: ${JSON.stringify({ before, after })}`);
  // Under reduced motion the indicator stands still and the run is still told.
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reduced = await evaluate(PANEL);
  await command("Emulation.setEmulatedMedia", { features: [] });
  assert(reduced.busy && reduced.turning === "none" && reduced.said === "Image download waiting before retry" && reduced.detail.includes("Trying again in "), `Reduced motion hid the run's state: ${JSON.stringify(reduced)}`);
  await evaluate("document.getElementById('mediaCancelOverlay').click()");
  await waitFor("document.getElementById('overlaySummary').textContent==='CANCELLED'", 5000);
  await openBuildChooser();
  assert(await evaluate("!document.getElementById('buildImagesAction').disabled"), "Build did not offer a new image run after a cancelled one.");
  await evaluate("document.getElementById('closeOverlay').click()");
  await cancelWhileTheBuiltArchiveIsBeingChecked();
}

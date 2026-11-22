import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";
import { LIMITED_PACE, MODEL, running, SLOW } from "./buildstatusfocusedmodelandkeys.mjs";
import { checkBuildStatusLandmarkKeyboardAndViewports } from "./buildstatuslandmarkkeyboardandviewports.mjs";
import { emit, read, W1 } from "./buildstatussyntheticbridge.mjs";

// The focused Build Status steps of PARSER_HARDENING.md §15.2 that the caution and renderer check leaves open: an
// older status degrades without throwing; identical statuses write nothing and a changed warning writes once; pushed
// and polled statuses end on the greatest revision; Close holds through a terminal partial; Continue and the roster
// Start look unavailable, stay focusable and open W-25, whose dialog returns focus to its invoker; the landmark, the
// polite tape and the parts that are not live; keyboard operation; the four viewports of §15.2; the image job's own
// lines and controls; and the §11.3 texts scanned for what no text may name. It runs after the notice check,
// through the caution check's synthetic bridge, from statusRevision 70.

export async function checkBuildStatusFocusedSteps() {
  const failures = await evaluate(MODEL);
  assert(failures.length === 0, `Build Status focused model steps: ${failures.join(" | ")}`);
  assert(await evaluate("Boolean(window.__wp6)"), "The caution check's synthetic bridge is not connected.");
  await evaluate(`(() => { window.__wp6.polls = 0; window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'GET_STATUS' && event.data?.bridgeSessionId === window.__wp6.session) window.__wp6.polls += 1; }); return true; })()`);

  // The panel opened by Build, expanded, on a braked run with three log lines.
  await emit(running(`{ activityLog: window.__wp6.activities(3, 1), pace: ${LIMITED_PACE} }`, 70));
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor(`!document.querySelector('#parserOverlay').hidden && document.querySelector('#eventLog').children.length === 3 && document.querySelector('#cautionTapeText').textContent === ${JSON.stringify(W1)}`);
  await evaluate("document.querySelector('#parserOverlay').classList.contains('minimized') && document.querySelector('#minimizeOverlay').click()");

  // Five identical statuses, then new log lines: nothing changes on the tape or the activity image, and every log row
  // keeps its node. A changed warning then writes its live text once, however often it is repeated.
  const writes = await evaluate(`new Promise((resolve) => {
    const records = []; const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.querySelector('#cautionTape'), { subtree: true, childList: true, characterData: true, attributes: true });
    observer.observe(document.querySelector('#collectionActivityImage'), { attributes: true, attributeFilter: ['src'] });
    const rows = [...document.querySelector('#eventLog').children];
    for (let index = 0; index < 5; index += 1) window.__wp6.emit(structuredClone(window.__wp6.status));
    setTimeout(() => {
      const identical = records.length;
      window.__wp6.emit(Object.assign(window.__wp6.running({ activityLog: window.__wp6.activities(5, 1), pace: ${LIMITED_PACE} }), { statusRevision: 70 }));
      setTimeout(() => {
        const lines = records.length - identical; const now = [...document.querySelector('#eventLog').children];
        const written = []; const text = new MutationObserver((list) => { for (const record of list) written.push([...record.addedNodes].map((node) => node.textContent).join('') || record.target.textContent); });
        text.observe(document.querySelector('#cautionTapeText'), { subtree: true, childList: true, characterData: true });
        const slow = Object.assign(window.__wp6.running({ activityLog: window.__wp6.activities(5, 1), pace: { factor: 4, warning: 'slow', waitingUntil: null, statusPage: null } }), { statusRevision: 70 });
        window.__wp6.emit(slow); window.__wp6.emit(structuredClone(slow)); window.__wp6.emit(structuredClone(slow));
        setTimeout(() => { observer.disconnect(); text.disconnect();
          resolve({ identical, lines, kept: rows.every((row) => now.includes(row)), rows: now.length, liveWrites: written.length, written, text: document.querySelector('#cautionTapeText').textContent }); }, 300);
      }, 300);
    }, 300);
  })`);
  assert(writes.identical === 0 && writes.lines === 0 && writes.kept && writes.rows === 5 && writes.liveWrites === 1 && writes.text === SLOW,
    `Identical statuses or new log lines wrote to the tape or the activity image, or a changed warning wrote more than once: ${JSON.stringify(writes)}`);

  // Pushed and polled statuses interleaved: a poll that answers an older revision than the last push changes nothing;
  // a newer revision that only the poll carries is applied.
  await emit(running(`{ pace: ${LIMITED_PACE} }`, 72));
  await waitFor(`document.querySelector('#cautionTapeText').textContent === ${JSON.stringify(W1)}`);
  await evaluate("window.__wp6.status = Object.assign(window.__wp6.running({ status: 'paused' }, { status: 'paused' }), { statusRevision: 71 }); true");
  const polls = await evaluate("window.__wp6.polls");
  await waitFor(`window.__wp6.polls > ${polls}`, 12000);
  await quiet();
  assert(await read("#overlaySummary") === "COLLECTING", "A polled status of an older revision rolled back the pushed one.");
  await evaluate("window.__wp6.status = Object.assign(window.__wp6.running({ status: 'paused' }, { status: 'paused' }), { statusRevision: 73 }); true");
  await waitFor("document.querySelector('#overlaySummary').textContent === 'PAUSED'", 12000);

  // Close holds through a terminal partial. Build reopens the panel with its chooser; the next status render hands
  // the panel back to the status, here the partial's.
  await evaluate("document.querySelector('#closeOverlay').focus(); document.querySelector('#closeOverlay').click()");
  await emit("Object.assign({ status: 'idle', hasActiveJob: false, continuable: false, activeJob: window.__wp6.job({ status: 'partial', mode: 'update', setAsideSections: ['buybackDetails'] }) }, { statusRevision: 74 })");
  await quiet();
  assert(await evaluate("document.querySelector('#parserOverlay').hidden"), "A terminal partial reopened the panel the user closed.");
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#parserOverlay').hidden");
  const reopened = await evaluate("({ summary: document.querySelector('#overlaySummary').textContent, operation: document.querySelector('#overlayState').textContent, detail: document.querySelector('#overlayDetail').textContent, chooser: " +
    "!document.querySelector('#buildChoices').hidden })");
  assert(reopened.chooser && reopened.summary === "READY", `Build did not reopen the panel with its chooser: ${JSON.stringify(reopened)}`);
  await emit("structuredClone(window.__wp6.status)");
  await waitFor("document.querySelector('#buildChoices').hidden && document.querySelector('#overlaySummary').textContent === 'COMPLETED WITH OMISSIONS'");

  // A continuable stop in its cool-down: Continue looks unavailable like Build and stays focusable. Organizations Build
  // and the roster Start carry the same mark and explanation; here both are also disabled by their own rules, as no
  // roster run is offered. Continue opens W-25, and closing the dialog returns focus to Continue.
  await emit(`Object.assign({ status: 'idle', hasActiveJob: false, continuable: true, retryNotBefore: new Date(Date.now() + 90000).toISOString(), activeJob: window.__wp6.job({ status: 'failed', failure: { code: 'RSI_RATE_LIMITED', message: 'RSI kept ` +
    `refusing requests.', detail: { signal: null, diagnosis: null } } }) }, { statusRevision: 75 })`);
  await waitFor("document.querySelector('#resumeCollection').getClientRects().length > 0 && document.querySelector('#resumeCollection').getAttribute('aria-disabled') === 'true'");
  const cooling = await evaluate(`(() => { const resume = document.querySelector('#resumeCollection'); resume.focus(); const style = getComputedStyle(resume); const start = document.querySelector('#orgBuildStart');
    return { focused: document.activeElement === resume, disabled: resume.disabled, label: resume.textContent, opacity: style.opacity, cursor: style.cursor, described: resume.getAttribute('aria-describedby'),
      start: [start.getAttribute('aria-disabled'), start.getAttribute('aria-describedby')].join('|'), org: [document.querySelector('#buildOrgButton').getAttribute('aria-disabled'),
        document.querySelector('#buildOrgButton').getAttribute('aria-describedby')].join('|'), build: document.querySelector('#buildButton').getAttribute('aria-disabled') }; })()`);
  assert(cooling.focused && !cooling.disabled && cooling.label.startsWith("Continue") && cooling.opacity === "0.5" && cooling.cursor === "not-allowed" && cooling.described === "coolDownExplanation"
    && cooling.start === "true|coolDownExplanation" && cooling.org === "true|coolDownExplanation" && cooling.build === "true", `Continue or the roster controls do not look unavailable during the cool-down: ${JSON.stringify(cooling)}`);
  await evaluate("document.querySelector('#resumeCollection').click()");
  await waitFor("document.querySelector('#messageDialog').open && document.querySelector('#dialogTitle').textContent === 'Cooling down'");
  await evaluate("document.querySelector('#messageDialog .button-primary').click()");
  await waitFor("!document.querySelector('#messageDialog').open");
  assert(await evaluate("document.activeElement === document.querySelector('#resumeCollection')"), `Closing W-25 did not return focus to Continue: ${await evaluate("document.activeElement?.id || document.activeElement?.tagName")}`);

  await checkBuildStatusLandmarkKeyboardAndViewports();
}

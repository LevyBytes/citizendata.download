// The Build Status renderer's later steps (PARSER_HARDENING.md §11.2, §15.2), after the caution tape's: stable nodes
// and a keyed append-only log that keeps its scroll, countdown-only ticks, one announcement per logical state, stale
// revisions ignored, and job kinds kept apart. Called by build-status-caution-and-renderer-check.mjs.
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";
import { emit, read } from "./buildstatussyntheticbridge.mjs";

export async function checkBuildStatusNodesLogAndRevisions() {
  // Stable nodes and a keyed, append-only log: a new activity is one new row; every other node is the same node.
  await emit("window.__wp6.running({ activityLog: window.__wp6.activities(2, 1), pace: { factor: 4, warning: 'limited' } })");
  await waitFor("document.querySelector('#eventLog').children.length === 2");
  await evaluate("window.__wp6.nodes = { rows: [...document.querySelector('#eventLog').children], tape: document.querySelector('#cautionTape'), progress: document.querySelector('#collectionActivityProgress'), image: " +
    "document.querySelector('#collectionActivityImage') }; true");
  await emit("window.__wp6.running({ activityLog: window.__wp6.activities(3, 1), pace: { factor: 4, warning: 'limited' } })");
  await waitFor("document.querySelector('#eventLog').children.length === 3");
  const keyed = await evaluate(`(() => { const rows = [...document.querySelector('#eventLog').children]; const kept = window.__wp6.nodes;
    return { kept: rows[1] === kept.rows[0] && rows[2] === kept.rows[1], newest: rows[0].dataset.logKey, same: document.querySelector('#cautionTape') === kept.tape && document.querySelector('#collectionActivityProgress') === kept.progress &&
      document.querySelector('#collectionActivityImage') === kept.image }; })()`);
  assert(keyed.kept && keyed.newest === "seq:3" && keyed.same, `The log or panel nodes were replaced: ${JSON.stringify(keyed)}`);

  // A log scrolled away from its top keeps its first visible row where it was while newer rows arrive.
  await emit("window.__wp6.running({ activityLog: window.__wp6.activities(20, 1), pace: { factor: 4, warning: 'limited' } })");
  await waitFor("document.querySelector('#eventLog').children.length === 20");
  const before = await evaluate(`(() => { const log = document.querySelector('#eventLog'); log.scrollTop = 60; const top = log.getBoundingClientRect().top;
    const row = [...log.children].find((child) => child.getBoundingClientRect().bottom > top); window.__wp6.anchor = row; return row.getBoundingClientRect().top - top; })()`);
  await emit("window.__wp6.running({ activityLog: window.__wp6.activities(20, 3), pace: { factor: 4, warning: 'limited' } })");
  await waitFor("document.querySelector('#eventLog').firstElementChild.dataset.logKey === 'seq:22'");
  const after = await evaluate("(() => { const log = document.querySelector('#eventLog'); return window.__wp6.anchor.isConnected ? window.__wp6.anchor.getBoundingClientRect().top - log.getBoundingClientRect().top : null; })()");
  assert(after !== null && Math.abs(after - before) <= 1, `The scrolled log moved its first visible row: ${before} then ${after}`);

  // A wait's countdown: the one-second timer changes the countdown's time only, and an unchanged status changes nothing.
  await emit("window.__wp6.running({ activityLog: window.__wp6.activities(3, 1), pace: { factor: 4, warning: 'limited', waitingUntil: new Date(Date.now() + 30000).toISOString() } })");
  await waitFor("document.querySelector('#overlayDetail time.countdown') !== null");
  const outside = await evaluate(`new Promise((resolve) => {
    // The header's decorative art animates on its own; the status lives in the body, the tape and the header's text.
    const records = []; const observer = new MutationObserver((list) => records.push(...list));
    for (const selector of ['#parserOverlayBody', '#cautionTape', '#overlaySummary', '#overlayTitle']) observer.observe(document.querySelector(selector), { subtree: true, childList: true, characterData: true, attributes: true });
    setTimeout(() => window.__wp6.emit(structuredClone(window.__wp6.status)), 300);
    setTimeout(() => { observer.disconnect(); const node = (record) => record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
      resolve({ total: records.length, outside: records.filter((record) => !node(record)?.closest('time.countdown')).map((record) => record.type + ':' + (node(record)?.id || node(record)?.className || node(record)?.tagName)) }); }, 2300);
  })`);
  assert(outside.total > 0 && outside.outside.length === 0, `Something besides the countdown changed during a wait: ${JSON.stringify(outside)}`);
  const summary = await read("#overlayDetail");
  assert(/^RSI refused\. Retrying in [0-9]+:[0-9]{2}\.$/u.test(summary) && (await read("#overlayDetail", "dataset.prose")) === "warning"
    && await evaluate("parseFloat(getComputedStyle(document.querySelector('#overlayDetail')).fontSize) >= 13"), `W-8 is not shown at 13 px: ${summary}`);

  // One announcement per logical state: repeats announce nothing, a new state once.
  const announced = await evaluate(`new Promise((resolve) => {
    const node = document.querySelector('#buildStatusAnnouncement'); let count = 0; const observer = new MutationObserver((list) => { count += list.length; }); observer.observe(node, { childList: true, characterData: true, subtree: true });
    const status = window.__wp6.running({ pace: { factor: 4, warning: 'limited' } });
    window.__wp6.emit(status); window.__wp6.emit(structuredClone(status)); window.__wp6.emit(structuredClone(status));
    setTimeout(() => { const repeats = count; count = 0; window.__wp6.emit(window.__wp6.running({ status: 'paused', activeJob: window.__wp6.job({ status: 'paused' }) }));
      setTimeout(() => { observer.disconnect(); resolve({ repeats, change: count, text: node.textContent }); }, 200); }, 200);
  })`);
  assert(announced.repeats <= 1 && announced.change === 1 && announced.text === "Build status: PAUSED. Reading your current Hangar.", `The live region announced ${JSON.stringify(announced)}`);

  // A stale revision is ignored; a newer one is applied.
  await emit("Object.assign(window.__wp6.running({}), { statusRevision: 50 })");
  await waitFor("document.querySelector('#overlaySummary').textContent === 'COLLECTING'");
  await emit("Object.assign(window.__wp6.running({ status: 'paused' }, { status: 'paused' }), { statusRevision: 49 })");
  await quiet();
  assert(await read("#overlaySummary") === "COLLECTING", "An older revision rolled the panel back.");
  await emit("Object.assign(window.__wp6.running({ status: 'paused' }, { status: 'paused' }), { statusRevision: 51 })");
  await waitFor("document.querySelector('#overlaySummary').textContent === 'PAUSED'");

  // Job kinds stay apart: a roster run has no Skip and its own operation; an account run in CCU buyback prices has Skip.
  await emit("Object.assign(window.__wp6.running({ jobKind: 'organizationData', currentSection: 'organizations.members.TEST' }), { statusRevision: 52 })");
  await waitFor("document.querySelector('#overlayOperation').textContent === 'ORGANIZATION DATA'");
  assert(await evaluate("document.querySelector('#skipCollection').hidden && document.querySelector('#overlayState').textContent === 'Reading the TEST member roster'"), "The roster run showed an account control or operation.");
  await emit("Object.assign(window.__wp6.running({ currentSection: 'buybackUpgradePrices' }), { statusRevision: 53 })");
  await waitFor("document.querySelector('#overlayOperation').textContent === 'ACCOUNT DATA' && !document.querySelector('#skipCollection').hidden");
  assert(await read("#overlayState") === "Reading CCU buyback prices", "The account operation was not its own.");
}

import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";
import { MODEL_MATRIX } from "./buildstatusmodelmatrix.mjs";
import { checkBuildStatusNodesLogAndRevisions } from "./buildstatusnodeslogandrevisions.mjs";
import { checkBuildStatusRefusedStartsAndZoom } from "./buildstatusrefusedstartsandzoom.mjs";
import { emit, frame, INSTALL_BRIDGE, LIMITED, media, W1 } from "./buildstatussyntheticbridge.mjs";

// Build Status while RSI refuses (PARSER_HARDENING.md §11.1 to §11.3): the presentation matrix and the caution tape's
// precedence, the texts word for word, then the panel itself through its own synthetic bridge: the B2 tape's markup,
// direction, reduced motion, forced colours and 13 px prose; no status-driven reopen and focus back to Build on Close;
// stable nodes, a keyed append-only log that keeps its scroll, countdown-only ticks, stale revisions ignored, one
// announcement per logical state, unavailable starts that stay focusable and explain themselves, W-20, 200 % zoom and
// job-kind isolation.

export async function checkBuildStatusCautionAndRenderer() {
  const failures = await evaluate(MODEL_MATRIX);
  assert(failures.length === 0, `Build Status presentation matrix: ${failures.join(" | ")}`);

  await evaluate("document.querySelector('#messageDialog').open && document.querySelector('#messageDialog').close()");
  await evaluate("document.querySelector('#parserOverlay').hidden = true");
  await evaluate(INSTALL_BRIDGE);
  await waitFor("document.querySelector('#overlaySummary').textContent === 'CONNECTED'");

  // The B2 markup: the first child of the panel, before its header, with the fixed word hidden from assistive technology.
  const markup = await evaluate(`(() => {
    const overlay = document.querySelector('#parserOverlay'); const tape = document.querySelector('#cautionTape'); const word = tape.querySelector('.caution-tape-word'); const announcer = document.querySelector('#buildStatusAnnouncement');
    return { first: overlay.firstElementChild === tape, header: overlay.querySelector('#overlayHeader').compareDocumentPosition(tape) === Node.DOCUMENT_POSITION_PRECEDING, word: word.textContent, wordHidden: word.getAttribute('aria-hidden'),
      textRole: document.querySelector('#cautionTapeText').getAttribute('role'), announcer: [announcer.getAttribute('role'), announcer.getAttribute('aria-live'), announcer.getAttribute('aria-atomic'), announcer.className].join('|'),
      dialog: document.querySelector('#messageDialog').getAttribute('aria-labelledby') };
  })()`);
  assert(markup.first && markup.header && markup.word === "CAUTION" && markup.wordHidden === "true" && markup.textRole === "status"
    && markup.announcer === "status|polite|false|sr-only" && markup.dialog === "dialogTitle",
  `The caution tape markup or announcer differ from the plan: ${JSON.stringify(markup)}`);

  // A warning shows the tape; Build opens the panel, as the user's action. The text is W-1 and the bars move.
  await emit(LIMITED);
  await waitFor(`document.querySelector('#cautionTapeText').textContent === ${JSON.stringify(W1)}`);
  assert(await evaluate("document.querySelector('#parserOverlay').hidden"), "A warning opened the closed panel.");
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#parserOverlay').hidden");
  await frame();
  const active = await evaluate(`(() => {
    const tape = document.querySelector('#cautionTape'); const bars = getComputedStyle(tape, '::before'); const close = document.querySelector('#closeOverlay').getBoundingClientRect();
    const hit = document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2);
    const running = document.getAnimations().find((item) => item.animationName === 'caution-band-bars');
    return { active: tape.classList.contains('is-active'), animation: bars.animationName, position: getComputedStyle(tape).position, events: getComputedStyle(tape).pointerEvents,
      text: parseFloat(getComputedStyle(document.querySelector('#cautionTapeText')).fontSize), closeReachable: Boolean(hit?.closest('#closeOverlay')),
      frames: running ? running.effect.getKeyframes().map((frame) => frame.backgroundPosition ?? [frame.backgroundPositionX, frame.backgroundPositionY].join(' ')) : [] };
  })()`);
  // Left to right: the bars' tile moves from 0 to 40 px along x, and the words never move.
  assert(active.active && active.animation === "caution-band-bars" && active.position === "sticky" && active.events === "none" && active.text >= 13 && active.closeReachable
    && active.frames.at(-1) === "40px 0px",
  `The active tape is not the moving, sticky, click-through band with 13 px text: ${JSON.stringify(active)}`);

  // Reduced motion stops the bars; forced colours show a plain bordered warning.
  await media([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await frame();
  const reduced = await evaluate("(() => { const bars = getComputedStyle(document.querySelector('#cautionTape'), '::before'); return [bars.animationIterationCount, parseFloat(bars.animationDuration) < .001]; })()");
  assert(reduced[0] === "1" && reduced[1] === true, `Reduced motion did not stop the bars: ${JSON.stringify(reduced)}`);
  await media([{ name: "forced-colors", value: "active" }]);
  await frame();
  const forced = await evaluate("(() => { const tape = document.querySelector('#cautionTape'); return [getComputedStyle(tape, '::before').display, getComputedStyle(tape).borderTopStyle, getComputedStyle(tape).borderTopWidth]; })()");
  assert(forced[0] === "none" && forced[1] === "solid" && forced[2] === "3px", `Forced colours did not give a plain bordered warning: ${JSON.stringify(forced)}`);
  await media([]);

  // Minimize stays the user's: a new status keeps it. Close hides the panel, returns focus to Build, and no status
  // reopens it; Build does.
  await evaluate("document.querySelector('#parserOverlay').classList.contains('minimized') || document.querySelector('#minimizeOverlay').click()");
  await emit("window.__wp6.running({ pace: { factor: 4, warning: 'slow', waitingUntil: null, statusPage: null } })");
  await waitFor("document.querySelector('#cautionTapeText').textContent === 'RSI is answering slowly. Slowing down.'");
  assert(await evaluate("document.querySelector('#parserOverlay').classList.contains('minimized') && document.querySelector('#overlayTitle').textContent.startsWith('COLLECTING')"), "A status changed the minimized panel or left its title stale.");
  await evaluate("document.querySelector('#minimizeOverlay').click()");
  await evaluate("document.querySelector('#closeOverlay').focus(); document.querySelector('#closeOverlay').click()");
  assert(await evaluate("document.querySelector('#parserOverlay').hidden && document.activeElement === document.querySelector('#buildButton')"), "Close did not hide the panel and return focus to Build, which opened it.");
  await emit(LIMITED);
  await quiet();
  assert(await evaluate("document.querySelector('#parserOverlay').hidden"), "A warning reopened the panel the user closed.");
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#parserOverlay').hidden");

  await checkBuildStatusNodesLogAndRevisions();

  await checkBuildStatusRefusedStartsAndZoom();
}

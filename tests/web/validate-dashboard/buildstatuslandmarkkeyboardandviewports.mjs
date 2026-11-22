// The focused Build Status steps that follow the cool-down's (PARSER_HARDENING.md §15.2): the landmark and the live
// parts, keyboard operation, and the four viewports of §15.2 with every focused control inside the panel. Called by
// build-status-focused-steps-check.mjs.
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { PANEL_CONTROLS, press, running } from "./buildstatusfocusedmodelandkeys.mjs";
import { emit, frame } from "./buildstatussyntheticbridge.mjs";

export async function checkBuildStatusLandmarkKeyboardAndViewports() {
  // The landmark and the live parts: a complementary landmark named Build status, CAUTION outside the accessibility
  // tree, a polite tape, an alerting notice; the badge, summary, countdown and log are not live.
  await emit(running(`{ activityLog: window.__wp6.activities(3, 1), pace: { factor: 4, warning: 'limited', waitingUntil: new Date(Date.now() + 30000).toISOString(), statusPage: null } }`, 76));
  await waitFor("document.querySelector('#overlayDetail time.countdown') !== null");
  await command("Accessibility.enable");
  const tree = await command("Accessibility.getFullAXTree");
  await command("Accessibility.disable");
  const nodes = tree.nodes.filter((node) => !node.ignored);
  const landmark = nodes.some((node) => node.role?.value === "complementary" && node.name?.value === "Build status");
  const caution = nodes.some((node) => node.name?.value === "CAUTION");
  const live = await evaluate(`(() => { const lively = '[aria-live],[role="status"],[role="alert"],[role="log"],[role="timer"],[role="marquee"]';
    const text = document.querySelector('#cautionTapeText'); const notice = document.querySelector('#parserChangeNotice');
    return { tape: text.getAttribute('role') === 'status' && (text.getAttribute('aria-live') ?? 'polite') === 'polite', notice: notice.getAttribute('role'),
      quiet: ['#overlaySummary', '#overlayDetail', '#overlayDetail time.countdown', '#eventLog', '#overlayState', '#overlayTitle'].filter((selector) => document.querySelector(selector)?.closest(lively)) }; })()`);
  assert(landmark && !caution && live.tape && live.notice === "alert" && live.quiet.length === 0,
    `The landmark or the live regions differ from §15.2: ${JSON.stringify({ landmark, caution, ...live })}`);

  // Keyboard: Tab walks the panel's controls in order; Enter minimizes and expands; Space closes, and focus returns
  // to Build.
  const controls = await evaluate(PANEL_CONTROLS);
  await evaluate(`document.getElementById(${JSON.stringify(controls[0])}).focus()`);
  const reached = [await evaluate("document.activeElement.id")];
  for (let index = 0; index < controls.length + 4 && reached.at(-1) !== controls.at(-1); index += 1) {
    await press("Tab", "Tab", 9);
    reached.push(await evaluate("document.activeElement.id || document.activeElement.tagName"));
  }
  const order = controls.filter((id) => reached.includes(id));
  assert(order.length === controls.length && controls.every((id, index) => index === 0 || reached.indexOf(id) > reached.indexOf(controls[index - 1])),
    `Tab does not reach the panel's controls in order: ${JSON.stringify({ controls, reached })}`);
  await evaluate("document.querySelector('#minimizeOverlay').focus()");
  await press("Enter", "Enter", 13, "\r");
  assert(await evaluate("document.querySelector('#parserOverlay').classList.contains('minimized') && document.activeElement === document.querySelector('#minimizeOverlay')"), "Enter did not minimize the panel.");
  await press("Enter", "Enter", 13, "\r");
  assert(await evaluate("!document.querySelector('#parserOverlay').classList.contains('minimized')"), "Enter did not expand the panel again.");
  await evaluate("document.querySelector('#closeOverlay').focus()");
  await press(" ", "Space", 32, " ");
  assert(await evaluate("document.querySelector('#parserOverlay').hidden && document.activeElement === document.querySelector('#buildButton')"), "Space on Close did not close the panel and return focus to Build, which opened it.");
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#parserOverlay').hidden");
  await evaluate("document.querySelector('#parserOverlay').classList.contains('minimized') && document.querySelector('#minimizeOverlay').click()");

  // The four viewports of §15.2, 640 by 360 standing for 200 % zoom: long safe text stays inside the panel, the page
  // never scrolls sideways, and every control, once focused, shows inside the panel below the sticky tape.
  await emit(running(`{ activityLog: window.__wp6.activities(12, 1), pace: { factor: 4, warning: 'limited', waitingUntil: null, statusPage: { status: 'issue', reason: null, components: [{ name: 'Persistent Universe', state: 'unresolved issue' }, { ` +
    `name: 'Platform', state: 'disrupted' }, { name: 'Arena Commander', state: 'partial outage' }], httpStatus: 200, checkedAt: new Date().toISOString() } } }`, 77));
  await waitFor("document.querySelector('#cautionTapeText').textContent.startsWith('RSI reports a problem: Persistent Universe')");
  const original = await evaluate("[window.innerWidth, window.innerHeight]");
  const sizes = [];
  for (const [width, height] of [[1400, 900], [390, 844], [320, 640], [640, 360]]) {
    await setViewport(width, height);
    await frame();
    const fit = await evaluate(`(() => { const overlay = document.querySelector('#parserOverlay'); const text = document.querySelector('#cautionTapeText'); const tape = document.querySelector('#cautionTape');
      const hidden = [];
      for (const id of ${PANEL_CONTROLS}) {
        const node = document.getElementById(id); node.focus({ preventScroll: false });
        const box = node.getBoundingClientRect(); const band = tape.getBoundingClientRect(); const panel = overlay.getBoundingClientRect();
        const underTape = tape.classList.contains('is-active') && overlay.contains(tape) && box.top < band.bottom - 1 && !node.closest('#cautionTape');
        if (underTape || box.bottom > Math.min(panel.bottom, window.innerHeight) + 1 || box.top < Math.max(panel.top, 0) - 1) hidden.push(id + '@' + Math.round(box.top) + '/' + Math.round(band.bottom));
      }
      return { page: document.documentElement.scrollWidth <= window.innerWidth, overlay: overlay.scrollWidth <= overlay.clientWidth + 1, tape: text.scrollWidth <= text.clientWidth + 1, hidden }; })()`);
    sizes.push({ width, height, ...fit });
  }
  await setViewport(original[0], original[1]);
  await frame();
  const misfit = sizes.filter((size) => !size.page || !size.overlay || !size.tape || size.hidden.length > 0);
  assert(misfit.length === 0, `At these viewports the panel overflows, the page scrolls sideways, or a focused control is hidden: ${JSON.stringify(misfit)}`);

  await emit("Object.assign({ status: 'idle', hasActiveJob: false, activeJob: null }, { statusRevision: 79 })");
  await evaluate("document.querySelector('#parserOverlay').hidden = true");
}

// Build Status for a refused start (PARSER_HARDENING.md §11.2, §12.1): Build and Org Build look unavailable, stay
// focusable, point to the countdown and show W-25; W-20 tells a start RSI refuses with its diagnosis; and at 200 %
// zoom the panel, its tape and its summary wrap without scrolling sideways. Called by
// build-status-caution-and-renderer-check.mjs.
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { emit, frame, read } from "./buildstatussyntheticbridge.mjs";

export async function checkBuildStatusRefusedStartsAndZoom() {
  // A refused start: Build and Org Build look unavailable, stay focusable, point to the countdown, and show W-25.
  const refusedStart = "Object.assign({ status: 'idle', hasActiveJob: false, activeJob: null, retryNotBefore: new Date(Date.now() + 90000).toISOString(), startDiagnosis: { probe: 'not-run', status: 'ok', reason: null, components: [], checkedAt: new " +
    "Date().toISOString() } }, { statusRevision: 54 })";
  await emit(refusedStart);
  await waitFor("document.querySelector('#buildButton').getAttribute('aria-disabled') === 'true'");
  const unavailable = await evaluate(`(() => { const build = document.querySelector('#buildButton'); build.focus(); const style = getComputedStyle(build);
    return { focused: document.activeElement === build, disabled: build.disabled, described: build.getAttribute('aria-describedby'), explanation: document.querySelector('#coolDownExplanation').textContent, opacity: style.opacity, cursor: style.cursor,
      org: document.querySelector('#buildOrgButton').getAttribute('aria-disabled'), tape: document.querySelector('#cautionTapeText').textContent, summary: document.querySelector('#overlaySummary').textContent,
        operation: document.querySelector('#overlayState').textContent }; })()`);
  assert(unavailable.focused && !unavailable.disabled && unavailable.described === "coolDownExplanation" && /^Try again in [0-9]+:[0-9]{2}\.$/u.test(unavailable.explanation)
    && unavailable.opacity === "0.5" && unavailable.cursor === "not-allowed" && unavailable.org === "true"
    && unavailable.tape === "RSI refused or didn't answer the account check. RSI status page: no problems." && unavailable.summary === "CONNECTED" && unavailable.operation === "Ready to build again",
  `The refused start's unavailable controls, tape or panel differ: ${JSON.stringify(unavailable)}`);
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("document.querySelector('#messageDialog').open");
  assert(await read("#dialogEyebrow") === "RSI" && await read("#dialogTitle") === "Cooling down" && /^Try again in [0-9]+:[0-9]{2}\.$/u.test(await read("#dialogMessage")), "Build during the cool-down did not show W-25.");
  await evaluate("document.querySelector('#messageDialog').close()");

  // W-20: a start RSI refuses is told with its diagnosis and the time to try again.
  await emit("Object.assign({ status: 'idle', hasActiveJob: false, activeJob: null }, { statusRevision: 55 })");
  await waitFor("!document.querySelector('#buildButton').hasAttribute('aria-disabled')");
  await evaluate("window.__wp6.start = { ok: false, code: 'RSI_RATE_LIMITED', message: \"RSI refused or didn't answer the account check.\", retryNotBefore: new Date(Date.now() + 60000).toISOString(), diagnosis: { probe: 'not-run', status: 'unknown', " +
    "reason: 'no-permission', components: [], checkedAt: new Date().toISOString() } }; true");
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#buildChoices').hidden");
  await evaluate("document.querySelector('#buildAccountAction').click()");
  await waitFor("document.querySelector('#messageDialog').open && document.querySelector('#dialogTitle').textContent === 'RSI is refusing'");
  assert(/^RSI refused or didn't answer the account check\. RSI status page not checked\. Try again in [0-9]+:[0-9]{2}\.$/u.test(await read("#dialogMessage")), `W-20 differs: ${await read("#dialogMessage")}`);
  await evaluate("document.querySelector('#messageDialog').close()");

  // 200 % zoom: at half the width the panel, its tape and its summary wrap without scrolling sideways.
  const viewport = await evaluate("[window.innerWidth, window.innerHeight]");
  await emit("Object.assign(window.__wp6.running({ pace: { factor: 4, warning: 'limited', waitingUntil: null, statusPage: { status: 'issue', reason: null, components: [{ name: 'Persistent Universe', state: 'unresolved issue' }, { name: 'Platform', " +
    "state: 'disrupted' }], httpStatus: 200, checkedAt: new Date().toISOString() } } }), { statusRevision: 56 })");
  await evaluate("document.querySelector('#parserOverlay').hidden || true");
  await setViewport(Math.round(viewport[0] / 2), Math.round(viewport[1] / 2));
  await frame();
  const zoomed = await evaluate(`(() => { const overlay = document.querySelector('#parserOverlay'); const text = document.querySelector('#cautionTapeText');
    return { overlay: overlay.scrollWidth <= overlay.clientWidth + 1, tape: text.scrollWidth <= text.clientWidth + 1, content: text.textContent }; })()`);
  await setViewport(viewport[0], viewport[1]);
  assert(zoomed.overlay && zoomed.tape && zoomed.content === "RSI reports a problem: Persistent Universe (unresolved issue), Platform (disrupted).", `At 200 % zoom the panel or tape scrolls sideways: ${JSON.stringify(zoomed)}`);
  const dashes = new RegExp(`[${String.fromCharCode(8211, 8212)}-]`, "u");
  assert(!dashes.test(zoomed.content) && !dashes.test(unavailable.tape), "Warning prose holds a dash or hyphen.");

  await emit("Object.assign({ status: 'idle', hasActiveJob: false, activeJob: null }, { statusRevision: 57 })");
  await evaluate("document.querySelector('#parserOverlay').hidden = true");
}

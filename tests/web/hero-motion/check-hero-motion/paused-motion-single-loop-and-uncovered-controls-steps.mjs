import { pause } from "./chrome-process-and-devtools-commands.mjs";
import { assertStill } from "./hero-geometry-and-motion-readings.mjs";
import { assert, evaluate, evidence, viewport, waitFor } from "./page-evaluation-evidence-and-screenshots.mjs";

await evaluate("document.querySelector('footer').scrollIntoView({ behavior: 'instant', block: 'end' })");
await waitFor("document.querySelector('#overview').dataset.motionState === 'paused'");
evidence.offscreen = await assertStill('Offscreen hero');
await evaluate("document.querySelector('#overview').scrollIntoView({ behavior: 'instant', block: 'center' })");
await waitFor("document.querySelector('#overview').dataset.motionState === 'running'");
// Headless tabs do not consistently produce OS foreground changes. Exercise the real visibility handler with a bounded property override, then restore it.
await evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))");
evidence.hidden = await assertStill('Hidden document event');
evidence.hidden.method = 'Simulated hidden property plus actual visibilitychange handler; no OS tab switching claim';
await evaluate("delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))");
await waitFor("document.querySelector('#overview').dataset.motionState === 'running'");

await evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
evidence.pagehide = await assertStill('Pagehide event');
await evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))");
await waitFor("document.querySelector('#overview').dataset.motionState === 'running'");
evidence.pageshowResumed = true;
for (let index = 0; index < 4; index++) {
  await evaluate("document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); window.dispatchEvent(new Event('resize'))");
  await viewport(index % 2 ? 1440 : 1438);
}
await evaluate('window.__heroFrameEvents = []'); await pause(700);
const frames = await evaluate('window.__heroFrameEvents');
assert(frames.length > 10 && frames.length < 100 && frames.length === new Set(frames).size, 'Resize or repeated visibility/pageshow created duplicate animation loops');
evidence.singleAnimationLoop = { sampledFrames: frames.length, uniqueTimestamps: new Set(frames).size, sampledWindowMs: 700 };
await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
const controls = await evaluate(`['loadButton', 'buildButton'].map(id => { const button = document.getElementById(id), box = button.getBoundingClientRect(), target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); `
  + `return `
  + `{ id, hittable: button === target || button.contains(target) }; })`);
assert(controls.every(control => control.hittable), 'Decorative layers cover dashboard controls');
evidence.controls = controls;
// Build opens the build status panel, a fixed element whose stacking the page's CSS decides. At 380px it covers part
// of the banner (at 1440px the two do not meet), and there the banner's motion layers must stay beneath it.
await viewport(380, 800);
await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
await evaluate("document.querySelector('#buildButton').click()");
await waitFor("!document.querySelector('#parserOverlay').hidden && !document.querySelector('#buildChoices').hidden");
const panel = await evaluate(`(() => {
  const panel = document.querySelector('#parserOverlay'), a = panel.getBoundingClientRect(), b = document.querySelector('#overview').getBoundingClientRect();
  const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right), top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
  if (left >= right || top >= bottom) return { overlapArea: 0, onTop: [] };
  const onTop = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]].map(([x, y]) => panel.contains(document.elementFromPoint(left + (right - left) * x, top + (bottom - top) * y)));
  return { overlapArea: Math.round((right - left) * (bottom - top)), onTop };
})()`);
assert(panel.overlapArea > 0, 'The build status panel no longer meets the banner at 380px, so the check below would test nothing');
assert(panel.onTop.every(Boolean), 'Motion layer covers the build status panel');
evidence.buildPanel = { viewport: '380x800', ...panel };
await evaluate("document.querySelector('#closeOverlay').click()");
await waitFor("document.querySelector('#parserOverlay').hidden");
// A native dialog the page opens, here for a file it rejects, must be modal: the browser then draws it above every
// layer of the page.
await evaluate(`(() => {
  const transfer = new DataTransfer();
  transfer.items.add(new File(['not an account file'], 'hero-dialog-check.json', { type: 'application/json' }));
  const input = document.querySelector('#jsonFileInput');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor("document.querySelector('#messageDialog').open");
const dialogTop = await evaluate(`(() => {
  const dialog = document.querySelector('#messageDialog'), box = dialog.getBoundingClientRect();
  return dialog.matches(':modal') && dialog.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
})()`);
assert(dialogTop, 'Motion layer covers the native dialog');
await evaluate("document.querySelector('#messageDialog').close()");
await viewport(1440);
await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");

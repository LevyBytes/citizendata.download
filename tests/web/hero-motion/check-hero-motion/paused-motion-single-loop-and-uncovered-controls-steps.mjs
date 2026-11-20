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
await evaluate("document.querySelector('#buildButton').click()");
await waitFor("document.querySelector('#messageDialog').open");
const dialogTop = await evaluate(`(() => { const dialog = document.querySelector('#messageDialog'), box = dialog.getBoundingClientRect(); return dialog.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); })()`);
assert(dialogTop, 'Motion layer covers the native dialog');
await evaluate("document.querySelector('#messageDialog').close()");

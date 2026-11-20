import { pathToFileURL } from 'node:url';
import { collectRequestedAssets, pause } from "../browser-session.mjs";
import { entry, log, report, source } from "./options-report-and-asset-inventory.mjs";

export const observerSource = `(() => {
  window.__performanceSample = { longTasks: [], layoutShifts: [], lcp: [], heroFrames: 0, heroPaints: 0, supported: PerformanceObserver.supportedEntryTypes || [] };
  const observe = (type, field,
    map) => { if (!window.__performanceSample.supported.includes(type)) return; new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__performanceSample[field].push(map(entry)); }).observe({ type, buffered: true }); };
  observe('longtask', 'longTasks', entry => ({ startTime: entry.startTime, duration: entry.duration }));
  observe('layout-shift', 'layoutShifts', entry => ({ startTime: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput }));
  observe('largest-contentful-paint', 'lcp', entry => ({ startTime: entry.startTime, size: entry.size }));
  const frame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => frame(callback.name === 'animate' ? timestamp => { window.__performanceSample.heroFrames++; return callback(timestamp); } : callback);
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function(...args) { if (this.canvas.classList.contains('hero-embers')) window.__performanceSample.heroPaints++; return clear.apply(this,args); };
  document.addEventListener('DOMContentLoaded', async () => { await document.fonts.ready; frame(() => frame(() => { window.__performanceSample.readyAfterFontsMs = performance.now(); })); }, { once: true });
})();`;

export async function snapshot(session) {
  return session.evaluate(`(() => {
    const sample = window.__performanceSample;
    return { ...sample, nodes: document.querySelectorAll('*').length, navigation: performance.getEntriesByType('navigation')[0]?.toJSON(), paints: performance.getEntriesByType('paint').map(entry => ({ name: entry.name, startTime: entry.startTime })),
      resources: performance.getEntriesByType('resource').map(entry => ({ name: entry.name, duration: entry.duration, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize })),
      layoutShiftTotalExcludingRecentInput: sample.layoutShifts.filter(entry => !entry.hadRecentInput).reduce((sum,entry) => sum + entry.value,0) };
  })()`);
}
export async function load(session, kind, index) {
  const start = performance.now();
  session.requests = [];
  await session.command('Page.navigate', { url: pathToFileURL(entry).href });
  await session.until("document.readyState === 'complete' && window.__performanceSample?.readyAfterFontsMs && document.querySelectorAll('#inventoryRows tr').length === 3");
  const readyWallMs = performance.now() - start;
  await pause(1000);
  const data = await snapshot(session), metrics = await session.metrics();
  const requested = collectRequestedAssets(session.requests, source, report.assets);
  report.loads.push({ kind, index, readyWallMs, observationAfterReadyMs: 1000, initialResourceBytes: requested.bytes, resourceByteMethod: requested.source, localResources: requested.files.map(item=>item.path), metrics, ...data });
  log(`${kind} ${index}: document complete ${data.navigation?.loadEventEnd?.toFixed(1)}ms; ready after fonts ${data.readyAfterFontsMs?.toFixed(1)}ms; ${data.longTasks.length} long tasks`);
}
export async function action(session, label, code) {
  const result = await session.evaluate(`(async () => {
    const started = performance.now(), tasksBefore = window.__performanceSample.longTasks.length;
    ${code}
    const handlerEnd = performance.now();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { handlerMs: handlerEnd - started, nextFrameMs: performance.now() - started, nodes: document.querySelectorAll('*').length, renderedInventoryRows: document.querySelectorAll('#inventoryRows tr').length,
      longTasks: window.__performanceSample.longTasks.slice(tasksBefore) };
  })()`);
  report.interactions.push({ label, ...result });
  return result;
}

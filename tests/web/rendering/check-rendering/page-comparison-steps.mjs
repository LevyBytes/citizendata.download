// Compares one page of the reference with the same page now, at each of its widths, after the reference has been
// compared with itself.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { changedValues, differingElements, isGridTrack, propertiesToRead } from "./declared-properties-and-reading-comparison.mjs";
import { readElements } from "./element-readings-in-the-page.mjs";

const DESCRIBED = 3;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const READY = {
  dashboard: "new Promise((resolve, reject) => { if (globalThis.renderingCheckReady) { resolve(true); return; }"
    + " addEventListener('citizendata-dashboard-ready', () => resolve(true), { once: true });"
    + " setTimeout(() => reject(new Error('the dashboard sent no ready event within 20 s')), 20000); })",
  load: "new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else addEventListener('load', () => resolve(true), { once: true }); })"
};

// The stylesheets under the page's stylesheet folder in both trees.
export async function propertiesFor(spec, trees) {
  const stylesheets = [];
  for (const tree of [trees.referenceTree, trees.currentTree]) {
    const folder = path.join(tree, ...spec.stylesheets.split("/"));
    for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith(".css")) stylesheets.push(await readFile(path.join(entry.parentPath, entry.name), "utf8"));
    }
  }
  return propertiesToRead(stylesheets);
}

async function evaluate(session, expression) {
  const result = await session.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`The page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
}

async function readPage(session, url, width, spec, properties, detailIndex = null) {
  await session.command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  const loads = session.loads();
  await session.command("Page.navigate", { url });
  for (let attempt = 0; session.loads() === loads; attempt += 1) {
    if (attempt === 600) throw new Error(`${url} did not load within 30 s`);
    await pause(50);
  }
  await evaluate(session, READY[spec.ready]);
  const tracks = properties.flatMap((name, at) => (isGridTrack(name) ? [at] : []));
  return evaluate(session, `(${readElements})(${JSON.stringify(properties)}, ${JSON.stringify(tracks)}, ${JSON.stringify(detailIndex)})`);
}

// What differs in up to three elements, each read again in full on both sides.
async function describe(session, urls, width, spec, properties, before, change) {
  const lines = [];
  for (const at of change.differing.slice(0, DESCRIBED)) {
    const was = await readPage(session, urls[0], width, spec, properties, at);
    const is = await readPage(session, urls[1], width, spec, properties, at);
    const values = changedValues(was, is, before.tags[at] !== change.tags[at]).slice(0, 4);
    lines.push(`${width}px ${before.tags[at].toLowerCase()}${before.names[at]}: ${values.join(", ") || "differs only in its hashed reading"}`);
  }
  if (change.differing.length > DESCRIBED) lines.push(`${width}px: ${change.differing.length - DESCRIBED} more elements differ`);
  return lines;
}

// Returns { readings, retagged, selfCheck: [lines], differences: [lines] }. A width whose reference does not read the
// same twice is reported under selfCheck and not compared.
export async function comparePage(session, spec, trees, properties) {
  const urlOf = (tree) => pathToFileURL(path.join(tree, spec.folder, ...spec.page.split("/"))).href;
  const reference = urlOf(trees.referenceTree);
  const current = urlOf(trees.currentTree);
  const result = { readings: 0, retagged: 0, selfCheck: [], differences: [] };
  for (const width of spec.widths) {
    const first = await readPage(session, reference, width, spec, properties);
    const second = await readPage(session, reference, width, spec, properties);
    const again = differingElements(first, second);
    if (again.structure) { result.selfCheck.push(`${width}px: ${again.structure}`); continue; }
    if (again.differing.length > 0) {
      result.selfCheck.push(...await describe(session, [reference, reference], width, spec, properties, first, { ...again, tags: second.tags }));
      continue;
    }
    const now = await readPage(session, current, width, spec, properties);
    const change = differingElements(first, now);
    if (change.structure) { result.differences.push(`${width}px: ${change.structure}`); continue; }
    result.readings += now.names.length;
    result.retagged = change.retagged;
    result.differences.push(...await describe(session, [reference, current], width, spec, properties, first, { ...change, tags: now.tags }));
  }
  return result;
}

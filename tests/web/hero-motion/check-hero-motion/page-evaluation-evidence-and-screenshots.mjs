import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { command, pause } from "./chrome-process-and-devtools-commands.mjs";
import { browserFolder } from "./options-and-evidence-folders.mjs";

export const exceptions = [];
export const remote = [];
export const evidence = {};
export const geometry = [];
export const assert = (condition, message) => { if (!condition) throw new Error(message); };
export async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
export async function waitFor(expression) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await evaluate(expression)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
export async function viewport(width, height = 1000) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
export async function screenshot(name) {
  const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  await writeFile(path.join(browserFolder, name), Buffer.from(result.data, 'base64'));
}

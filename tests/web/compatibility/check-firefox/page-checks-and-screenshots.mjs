import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { command, context, pause } from "./firefox-process-and-bidi-commands.mjs";
import { out } from "./options-and-evidence-folders.mjs";

export const checks = [];
export const logs = [];
export const modes = [];
export async function evaluate(expression) {
  const response = await command('script.evaluate', { expression: `(async () => JSON.stringify(await (${expression})))()`, target: { context }, awaitPromise: true, userActivation: true });
  if (response.type !== 'success') throw new Error(response.exceptionDetails?.text || 'Script evaluation failed');
  return response.result.type === 'undefined' ? undefined : JSON.parse(response.result.value);
}
export async function waitFor(expression) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await pause(75); }
  throw new Error(`Expected state not reached: ${expression}`);
}
export async function check(name, expression) { assert.equal(await evaluate(expression), true, name); checks.push(name); }
export async function click(selector) { await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing test control'); element.focus(); element.click(); return true; })()`); }
export async function screenshot(name) { const result = await command('browsingContext.captureScreenshot', { context, origin: 'viewport' }); await writeFile(path.join(out, name + '.png'), Buffer.from(result.data, 'base64')); }

import { spawn } from 'node:child_process';
import { executable, profile, scratch } from "./options-and-evidence-folders.mjs";

export const chrome = spawn(
  executable,
  ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEMP: scratch, TMP: scratch, TMPDIR: scratch } }
);
let sequence = 0;
export let stderr = '';
export let spawnError;
// The steps that connect are a module of their own; a module reads another's variable and assigns it through this.
export let socket;
export const setSocket = value => { socket = value; };
chrome.stderr.on('data', chunk => { stderr += chunk; }); chrome.on('error', error => { spawnError = error; });
export const pending = new Map();
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function rejectPending(error) {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
}
export const command = (method, params = {}) => new Promise((resolve, reject) => {
  if (socket?.readyState !== WebSocket.OPEN) { reject(new Error(`Browser connection is not open: ${method}`)); return; }
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out after 15 seconds: ${method}`)); }, 15000);
  pending.set(id, { resolve, reject, timer });
  try { socket.send(JSON.stringify({ id, method, params })); }
  catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
});
export async function evaluate(expression) { const result = await command('Runtime.evaluate',
  { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
export async function waitFor(expression) { for (let attempt = 0; attempt < 160; attempt++) { if (await evaluate(expression)) return; await pause(50); } throw new Error(`Local UI not ready: ${expression}`); }

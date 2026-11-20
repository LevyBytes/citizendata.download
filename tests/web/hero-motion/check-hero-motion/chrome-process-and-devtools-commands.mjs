import { spawn } from 'node:child_process';
import { browserExecutable, profile, scratch } from "./options-and-evidence-folders.mjs";

export const chrome = spawn(browserExecutable, [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'
], {
  stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: { ...process.env, TEMP: scratch, TMP: scratch, TMPDIR: scratch },
});
let sequence = 0;
export let stderr = '';
export let spawnError;
// The steps that connect are a module of their own; a module reads another's variable and assigns it through this.
export let socket;
export const setSocket = value => { socket = value; };
chrome.stderr.on('data', chunk => { stderr += chunk; });
chrome.on('error', error => { spawnError = error; });
export const pending = new Map();
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function rejectPending(error) {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
}
export const command = (method, params = {}) => new Promise((resolve, reject) => {
  if (socket?.readyState !== WebSocket.OPEN) { reject(new Error(`CDP connection is unavailable for ${method}`)); return; }
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP command timed out after 15s: ${method}`)); }, 15000);
  pending.set(id, { resolve, reject, timer });
  try { socket.send(JSON.stringify({ id, method, params })); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
});

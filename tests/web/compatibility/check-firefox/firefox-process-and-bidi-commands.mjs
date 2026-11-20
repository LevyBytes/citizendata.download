import { spawn } from 'node:child_process';
import "./firefox-profile-and-account-fixture-file.mjs";
import { browserPath, profile, scratch } from "./options-and-evidence-folders.mjs";

export const child = spawn(browserPath, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0'], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, TEMP: scratch, TMP: scratch, TMPDIR: scratch, MOZ_CRASHREPORTER_DISABLE: '1' }
});
export let diagnostic = '', spawnError, sequence = 0;
// The steps that connect are a module of their own; a module reads another's variable and assigns it through these.
export let socket;
export let context;
export let capabilities;
export const setSocket = value => { socket = value; };
export const setContext = value => { context = value; };
export const setCapabilities = value => { capabilities = value; };
child.stdout.on('data', chunk => { diagnostic += chunk; });
child.stderr.on('data', chunk => { diagnostic += chunk; });
child.on('error', error => { spawnError = error; });
export const pending = new Map();
export const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export function rejectPending(error) { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); }
export function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN) { reject(new Error('BiDi connection is not open')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`BiDi timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    try { socket.send(JSON.stringify({ id, method, params })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { command, pause, pending, rejectPending, setSocket, socket, spawnError, stderr } from "./chrome-process-and-devtools-commands.mjs";
import { exceptions, remoteRequests } from "./evidence-lists-and-palette.mjs";
import { profile } from "./options-and-evidence-folders.mjs";

let port;
for (let attempt = 0; attempt < 120; attempt++) { if (spawnError) throw spawnError; try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/u)[0]; break; } catch { await pause(100); } }
if (!port) throw new Error(`Chrome not ready: ${stderr}`);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(10000) })).json();
setSocket(new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl));
socket.addEventListener('close', () => rejectPending(new Error('Browser connection closed')));
socket.addEventListener('error', () => rejectPending(new Error('Browser connection failed')));
await new Promise((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); socket.removeEventListener('open', opened); socket.removeEventListener('error', failed); socket.removeEventListener('close', failed); };
  const opened = () => { cleanup(); resolve(); };
  const failed = event => { cleanup(); reject(new Error(`Browser connection failed before opening: ${event.error?.message || event.reason || event.type}`)); };
  const timer = setTimeout(() => { cleanup(); reject(new Error('Browser connection timed out after 15 seconds')); }, 15000);
  socket.addEventListener('open', opened, { once: true }); socket.addEventListener('error', failed, { once: true }); socket.addEventListener('close', failed, { once: true });
});
socket.addEventListener('message',
  event => { const message = JSON.parse(event.data);
    if (message.id) { const request = pending.get(message.id); if (!request) return; clearTimeout(request.timer); pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text); else if (message.method === 'Network.requestWillBeSent'
    && /^https?:/u.test(message.params.request.url)) remoteRequests.push(message.params.request.url); });
await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
await command('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });

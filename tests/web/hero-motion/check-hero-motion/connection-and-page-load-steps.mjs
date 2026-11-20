import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chrome, command, pause, pending, rejectPending, setSocket, socket, spawnError, stderr } from "./chrome-process-and-devtools-commands.mjs";
import { profile, sourceEntry } from "./options-and-evidence-folders.mjs";
import { evaluate, exceptions, remote, viewport, waitFor } from "./page-evaluation-evidence-and-screenshots.mjs";

let port;
for (let attempt = 0; attempt < 120; attempt++) {
  if (spawnError) throw spawnError;
  if (chrome.exitCode !== null || chrome.signalCode !== null) throw new Error(`Chrome exited during startup: ${chrome.signalCode || chrome.exitCode}`);
  try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/u)[0]; break; } catch { await pause(100); }
}
if (!port) throw new Error(`Chrome not ready: ${stderr}`);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(10000) })).json();
setSocket(new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl));
socket.addEventListener('close', () => rejectPending(new Error('Chrome CDP connection closed')));
socket.addEventListener('error', () => rejectPending(new Error('Chrome CDP connection failed')));
await new Promise((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); socket.removeEventListener('open', opened); socket.removeEventListener('error', failed); socket.removeEventListener('close', failed); };
  const opened = () => { cleanup(); resolve(); };
  const failed = () => { cleanup(); reject(new Error('Could not open Chrome CDP connection')); };
  const timer = setTimeout(() => { cleanup(); reject(new Error('Chrome CDP handshake timed out after 10s')); }, 10000);
  socket.addEventListener('open', opened, { once: true }); socket.addEventListener('error', failed, { once: true }); socket.addEventListener('close', failed, { once: true });
});
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  else if (message.method === 'Network.requestWillBeSent' && /^https?:/u.test(message.params.request.url)) remote.push(message.params.request.url);
});
await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
await command('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
await command('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const originalClear = CanvasRenderingContext2D.prototype.clearRect, originalEllipse = CanvasRenderingContext2D.prototype.ellipse;
  CanvasRenderingContext2D.prototype.clearRect = function(...args) { if (this.canvas.classList.contains('hero-embers')) window.__heroParticles = []; return originalClear.apply(this, args); };
  CanvasRenderingContext2D.prototype.ellipse = function(...args) { if (this.canvas.classList.contains('hero-embers')) (window.__heroParticles ||= []).push({ x: args[0], y: args[1] }); return originalEllipse.apply(this, args); };
  const originalFrame = window.requestAnimationFrame.bind(window);
  window.__heroFrameEvents = [];
  window.requestAnimationFrame = function(callback) { if (callback.name !== 'animate') return originalFrame(callback); return originalFrame(timestamp => { window.__heroFrameEvents.push(timestamp); return callback(timestamp); }); };
})();` });
await viewport(1440);
await command('Page.navigate', { url: pathToFileURL(sourceEntry).href });
await waitFor("document.readyState === 'complete' && document.querySelector('#identityHeroArt')");
await evaluate('document.fonts.ready.then(() => true)');

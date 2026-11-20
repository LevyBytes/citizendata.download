import { child, command, context, diagnostic, pause, spawnError, pending, rejectPending, setCapabilities, setContext, setSocket, socket } from "./firefox-process-and-bidi-commands.mjs";
import { logs } from "./page-checks-and-screenshots.mjs";

let endpoint;
for (let attempt = 0; attempt < 150; attempt++) {
  if (spawnError) throw spawnError;
  endpoint = diagnostic.match(/WebDriver BiDi listening on (ws:\/\/127\.0\.0\.1:\d+)/u)?.[1];
  if (endpoint) break;
  if (child.exitCode !== null) throw new Error(`Firefox exited ${child.exitCode}: ${diagnostic}`);
  await pause(100);
}
if (!endpoint) throw new Error(`Firefox did not expose BiDi: ${diagnostic}`);
setSocket(new WebSocket(endpoint + '/session'));
socket.addEventListener('close', () => rejectPending(new Error('BiDi closed')));
socket.addEventListener('error', () => rejectPending(new Error('BiDi connection failed')));
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('BiDi open timed out')), 15000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', event => { clearTimeout(timer); reject(new Error(event.error?.message || 'BiDi open failed')); }, { once: true });
});
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const entry = pending.get(message.id); if (!entry) return;
    clearTimeout(entry.timer); pending.delete(message.id);
    message.type === 'error' ? entry.reject(new Error(`${message.error}: ${message.message}`)) : entry.resolve(message.result);
  } else if (message.method === 'log.entryAdded') logs.push(message.params);
});
setCapabilities((await command('session.new', { capabilities: { alwaysMatch: { browserName: 'firefox' } } })).capabilities);
setContext((await command('browsingContext.create', { type: 'tab' })).context);
await command('session.subscribe', { events: ['log.entryAdded'], contexts: [context] });

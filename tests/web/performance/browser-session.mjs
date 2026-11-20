import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class BrowserSession {
  static async open(executable, out) {
    await mkdir(out, { recursive: true });
    const session = new BrowserSession();
    session.out = path.resolve(out);
    session.scratch = await mkdtemp(path.join(session.out, 'work-temp-'));
    session.profile = path.join(session.scratch, 'profile');
    await mkdir(session.profile);
    session.pending = new Map(); session.sequence = 0; session.remote = []; session.requests = []; session.exceptions = []; session.stderr = '';
    session.process = spawn(
      executable,
      ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${session.profile}`, 'about:blank'],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: { ...process.env, TEMP: session.scratch, TMP: session.scratch, TMPDIR: session.scratch } }
    );
    session.process.stderr.on('data', chunk => { session.stderr += chunk; });
    session.process.on('error', error => { session.spawnError = error; });
    try {
      let port;
      for (let attempt = 0; attempt < 120; attempt++) {
        if (session.spawnError) throw session.spawnError;
        if (session.process.exitCode !== null || session.process.signalCode !== null) throw new Error('Browser exited during startup');
        try { port = (await readFile(path.join(session.profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/u)[0]; break; } catch { await pause(100); }
      }
      if (!port) throw new Error(`Browser did not expose a debugging port: ${session.stderr}`);
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(10000) })).json();
      session.socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
      session.socket.addEventListener('close', () => session.rejectPending(new Error('CDP socket closed')));
      session.socket.addEventListener('error', () => session.rejectPending(new Error('CDP socket failed')));
      await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); session.socket.removeEventListener('open', opened); session.socket.removeEventListener('error', failed); session.socket.removeEventListener('close', failed); };
        const opened = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('CDP handshake failed')); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('CDP handshake timed out')); }, 10000);
        session.socket.addEventListener('open', opened); session.socket.addEventListener('error', failed); session.socket.addEventListener('close', failed);
      });
      session.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) {
          const request = session.pending.get(message.id); if (!request) return;
          session.pending.delete(message.id); clearTimeout(request.timer);
          message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') session.exceptions.push(message.params.exceptionDetails.text);
        else if (message.method === 'Network.requestWillBeSent') { session.requests.push({ url: message.params.request.url, type: message.params.type }); if (/^https?:/u.test(message.params.request.url)) session.remote.push(message.params.request.url); }
      });
      await session.command('Page.enable'); await session.command('Runtime.enable'); await session.command('Network.enable'); await session.command('Performance.enable');
      await session.command('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
      await session.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      return session;
    } catch (error) { await session.close(); throw error; }
  }

  rejectPending(error) { for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); } this.pending.clear(); }
  command(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) { reject(new Error(`CDP unavailable: ${method}`)); return; }
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression) { const result = await this.command('Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  async until(expression,
    milliseconds = 15000) { const started = performance.now(); while (performance.now() - started < milliseconds) { if (await this.evaluate(expression)) return; await pause(50); } throw new Error(`Timed out waiting for local UI: ${expression}`); }
  async metrics() { const result = await this.command('Performance.getMetrics'); return Object.fromEntries(result.metrics.map(item => [item.name, item.value])); }
  async close() {
    this.rejectPending(new Error('Performance run is closing'));
    if (this.socket) this.socket.close();
    const running = () => this.process.pid && !this.spawnError && this.process.exitCode === null && this.process.signalCode === null;
    if (running()) this.process.kill();
    for (let attempt = 0; attempt < 100 && running(); attempt++) await pause(50);
    if (running()) throw new Error('Browser did not terminate; its owned profile is retained');
    if (path.dirname(path.resolve(this.scratch)) !== this.out) throw new Error('Scratch cleanup escaped --out');
    await rm(this.scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export function collectRequestedAssets(requests, source, inventory) {
  const paths = new Set();
  for (const request of requests) {
    if (!request.url.startsWith('file:')) continue;
    const url = new URL(request.url); url.search = ''; url.hash = '';
    const relative = path.relative(source, fileURLToPath(url));
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) paths.add(relative.replaceAll(path.sep, '/'));
  }
  const files = inventory.filter(item => paths.has(item.path));
  return { source: 'CDP file requests mapped to local uncompressed file sizes', files, bytes: files.reduce((sum,item) => sum + item.bytes,0) };
}

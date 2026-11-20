import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { baseAccountDocument } from "../../../fixtures/account-document.mjs";
import { server, setPlaywrightVersion, setServer } from "./evidence-lists-and-browser-in-use.mjs";
import { options, scratch, source } from "./options-and-evidence-folder.mjs";

await import('../../../../shared/account-document.js');

const require = createRequire(import.meta.url);
const modulePath = path.resolve(options['playwright-module']);
export const { webkit } = require(modulePath);
try { setPlaywrightVersion(require(path.join(modulePath, 'package.json')).version); } catch { setPlaywrightVersion('unknown'); }
const fixture = baseAccountDocument();
fixture.account.handle = 'CompatibilityCitizen'; fixture.profile.handle = 'CompatibilityCitizen';
export const fixtureFile = path.join(scratch, 'compatibility-example.json');
await writeFile(fixtureFile, JSON.stringify(await globalThis.CitizenDataAccountDocument.stampIntegrity(fixture)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json' };
setServer(createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(source, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(source, file);
    if (request.method !== 'GET' || relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
}));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
export const hosted = `http://127.0.0.1:${server.address().port}/`;

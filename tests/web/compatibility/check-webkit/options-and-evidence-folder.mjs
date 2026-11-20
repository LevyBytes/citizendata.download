import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Optional Playwright WebKit engine coverage, explicitly not branded Safari acceptance.
// https://playwright.dev/docs/browsers#webkit
const help = 'Usage: node check-webkit.mjs --playwright-module <installed package path> --browser <WebKit executable> --out <evidence directory> [--source <docs directory>]';
if (process.argv.includes('--help')) { console.log(help); process.exit(0); }
export let options, source, out;
try {
  options = parseArgs({ options: { 'playwright-module': { type: 'string' }, browser: { type: 'string' }, out: { type: 'string' }, source: { type: 'string' } }, strict: true }).values;
  if (!options['playwright-module'] || !options.browser || !options.out) throw new Error('--playwright-module, --browser, and --out are required');
  source = options.source ? path.resolve(options.source) : fileURLToPath(new URL('../../../../docs/', import.meta.url));
  out = path.resolve(options.out);
  if (!(await stat(path.resolve(options.browser))).isFile() || !(await stat(path.join(source, 'index.html'))).isFile()) throw new Error('Browser and docs/index.html must exist');
} catch (error) { console.error(`${error.message}\n${help}`); process.exit(2); }
await mkdir(out, { recursive: true });
export const scratch = await mkdtemp(path.join(out, 'webkit-temp-'));
export const originalTemp = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR'].map(key => [key, process.env[key]]));
for (const key of Object.keys(originalTemp)) process.env[key] = scratch;

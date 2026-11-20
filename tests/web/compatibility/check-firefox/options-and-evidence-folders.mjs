import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Stock Firefox supports WebDriver BiDi directly; no Playwright browser patch is needed.
// https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection
const help = 'Usage: node check-firefox.mjs --browser <Firefox executable> --out <evidence directory> [--source <docs directory>]';
if (process.argv.includes('--help')) { console.log(help); process.exit(0); }
export let browserPath, source, out;
try {
  const options = parseArgs({ options: { browser: { type: 'string' }, out: { type: 'string' }, source: { type: 'string' } }, strict: true }).values;
  if (!options.browser || !options.out) throw new Error('--browser and --out are required');
  browserPath = path.resolve(options.browser); out = path.resolve(options.out);
  source = options.source ? path.resolve(options.source) : fileURLToPath(new URL('../../../../docs/', import.meta.url));
  if (!(await stat(browserPath)).isFile() || !(await stat(path.join(source, 'index.html'))).isFile()) throw new Error('Browser and docs/index.html must exist');
} catch (error) { console.error(`${error.message}\n${help}`); process.exit(2); }
await mkdir(out, { recursive: true });
export const scratch = await mkdtemp(path.join(out, 'firefox-temp-'));
export const profile = path.join(scratch, 'profile');
export const downloads = path.join(scratch, 'downloads');
await mkdir(profile); await mkdir(downloads);

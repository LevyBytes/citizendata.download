import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const help = `Usage: node tests/web/hero-motion/check-hero-motion.mjs --out <evidence-directory> [--source <local-html-or-directory>] [--browser <Chrome-executable>]

Checks local hero animation, lifecycle suspension, layering, and responsive layout.
Source defaults to this checkout's docs/index.html. --out is required; screenshots,
JSON receipts, temporary browser profiles, and TEMP/TMP are confined to that folder.
Chrome defaults to its ProgramFiles installation on Windows. Other installations
and platforms must provide --browser. No dependencies are installed or PATH changed.
Exit 0: all checks passed; 1: a check or browser run failed; 2: invalid arguments.
`;
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(help); process.exit(0); }
export let browserFolder, sourceEntry, browserExecutable;
try {
  const options = parseArgs({ options: { out: { type: 'string' }, source: { type: 'string' }, browser: { type: 'string' } }, strict: true }).values;
  if (!options.out) throw new Error('--out is required');
  browserFolder = path.resolve(options.out);
  const defaultSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs');
  const source = path.resolve(options.source || defaultSource);
  sourceEntry = (await stat(source)).isDirectory() ? path.join(source, 'index.html') : source;
  if (!(await stat(sourceEntry)).isFile()) throw new Error('--source must resolve to a local HTML file');
  browserExecutable = options.browser || (process.platform === 'win32' && process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') : null);
  if (!browserExecutable) throw new Error('--browser is required for this platform or installation');
  browserExecutable = path.resolve(browserExecutable);
  if (!(await stat(browserExecutable)).isFile()) throw new Error('--browser must name an installed executable');
} catch (error) { console.error(`Hero motion: ${error.message}\n${help}`); process.exit(2); }
await mkdir(browserFolder, { recursive: true });
export const scratch = await mkdtemp(path.join(browserFolder, 'work-temp-'));
export const profile = path.join(scratch, 'profile');
if (path.dirname(path.resolve(scratch)) !== browserFolder) throw new Error('Scratch directory escaped --out');
await mkdir(profile, { recursive: true });

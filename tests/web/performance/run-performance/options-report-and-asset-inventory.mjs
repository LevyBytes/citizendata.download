import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const help = `Usage: node tests/web/performance/run-performance.mjs --out <evidence-directory> [--browser chrome|edge|<executable>] [--source <local-docs-directory>] [--runs 3..5]

Runs repeatable local-file load and synthetic-data measurements in Chrome or Edge.
Source defaults to this checkout's docs. --out is required for all runtime evidence,
profiles and temporary files. Browser names resolve installed Windows locations;
other installations/platforms use an explicit executable. No installs or PATH edits.
Exit 0: behavior checks completed; 1: failed check/runtime; 2: invalid arguments.
Timing results are measurements, not production Web Vitals or browser guarantees.
`;
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(help); process.exit(0); }
export let source, entry, out, executable, runs;
try {
  const args = parseArgs({ options: { out: { type: 'string' }, browser: { type: 'string', default: 'chrome' }, source: { type: 'string' }, runs: { type: 'string', default: '3' } }, strict: true }).values;
  if (!args.out) throw new Error('--out is required');
  out = path.resolve(args.out); runs = Number(args.runs);
  if (!Number.isInteger(runs) || runs < 3 || runs > 5) throw new Error('--runs must be an integer from 3 to 5');
  source = path.resolve(args.source || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs'));
  entry = path.join(source, 'index.html'); if (!(await stat(entry)).isFile()) throw new Error('Source must contain index.html');
  if (['chrome', 'edge'].includes(args.browser)) {
    if (process.platform !== 'win32') throw new Error('Provide an explicit --browser executable on this platform');
    const root = args.browser === 'edge' ? process.env['ProgramFiles(x86)'] || process.env.ProgramFiles : process.env.ProgramFiles;
    if (!root) throw new Error('Installed browser root is unavailable; provide an executable');
    executable = path.join(root, ...(args.browser === 'edge' ? ['Microsoft', 'Edge', 'Application', 'msedge.exe'] : ['Google', 'Chrome', 'Application', 'chrome.exe']));
  } else executable = path.resolve(args.browser);
  if (!(await stat(executable)).isFile()) throw new Error('--browser must resolve to an installed executable');
} catch (error) { console.error(`${error.message}\n${help}`); process.exit(2); }
await mkdir(out, { recursive: true });
export const assert = (condition, message) => { if (!condition) throw new Error(message); };
export const outputLines = [];
export const log = message => { outputLines.push(message); console.log(message); };
export const report = { source, startedAt: new Date().toISOString(), runs,
  environment: { platform: process.platform, release: os.release(), arch: process.arch, node: process.version, logicalCpus: os.cpus().length, cpu: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem(), viewport: { width: 1440, height: 1000 },
  headless: true, gpuDisabled: true }, loads: [], interactions: [], motion: [], exceptions: [], remoteRequests: [], failures: [],
  limitations: ['Local file URLs; no network latency, server compression, HTTP caching, hosted deployment, field Web Vitals, or Lighthouse claims.',
  'Fresh profiles are browser-cache cold; the OS filesystem cache is not cleared. Warm samples reload in the last existing profile.',
  'Long-task and layout-shift observations are bounded samples. Local paint/LCP values are diagnostics, not final production scores.', 'Synthetic payload has bounded image-free collection rows and does not represent every real account or image package.',
  'CPU values are renderer main-thread TaskDuration deltas, not total machine/process/GPU energy.'] };

async function inventory(folder, relative = '') {
  const files = [];
  for (const item of await readdir(path.join(folder, relative), { withFileTypes: true })) {
    const name = path.join(relative, item.name);
    if (item.isDirectory()) files.push(...await inventory(folder, name));
    else if (item.isFile()) files.push({ path: name.replaceAll(path.sep, '/'), bytes: (await stat(path.join(folder, name))).size });
  }
  return files;
}
report.assets = (await inventory(source)).sort((a, b) => b.bytes - a.bytes);
report.assetBytes = report.assets.reduce((sum, item) => sum + item.bytes, 0);

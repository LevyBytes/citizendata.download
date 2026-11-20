import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const defaultSource = fileURLToPath(new URL('../../../../docs/index.html', import.meta.url));
const defaultStates = fileURLToPath(new URL('../citizendata-states.json', import.meta.url));
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const help = `Usage: node check-readability.mjs --out <evidence directory> [--source <local HTML or directory>] [--browser <Chrome executable>] [--states <local JSON plan>]

Measures visible text against established solid CSS backgrounds. Complex painted
backgrounds are MANUAL, never a claimed contrast pass. Optional state plans select
local UI states and explicit limited palette pairs. No source files are edited.
Source defaults to this repository's docs/index.html with the CitizenData state plan.
Other explicit sources use a generic entry state unless --states is supplied.
Browser defaults to Chrome under Windows ProgramFiles; elsewhere --browser is required.
HTTP(S) page requests are blocked and reported. Profiles/TEMP/TMP stay below --out.
Exit 0: completed without measured failures; 1: measured failure or runtime error;
2: invalid arguments. Manual cases still need review; this is not WCAG certification.
`;
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(help); process.exit(0); }
export let options, source, out, plan, executable;
try {
  options = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string' }, browser: { type: 'string' }, states: { type: 'string' } }, strict: true }).values;
  if (!options.out) throw new Error('--out is required');
  source = options.source ? path.resolve(options.source) : defaultSource; out = path.resolve(options.out);
  if ((await stat(source)).isDirectory()) source = path.join(source, 'index.html');
  if (!(await stat(source)).isFile()) throw new Error('--source must resolve to a local HTML file');
  const stateFile = options.states ? path.resolve(options.states) : samePath(source, defaultSource) ? defaultStates : null;
  plan = stateFile ? JSON.parse(await readFile(stateFile, 'utf8')) : { states: [{ name: 'entry', actions: [] }], viewports: [{ width: 1440, height: 1000 }] };
  if (!Array.isArray(plan.states) || !plan.states.length || !Array.isArray(plan.viewports) || !plan.viewports.length) throw new Error('State plan needs nonempty states and viewports arrays');
  const defaultBrowser = process.platform === 'win32' && process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') : null;
  if (!options.browser && !defaultBrowser) throw new Error('--browser is required when Windows ProgramFiles Chrome is unavailable');
  executable = path.resolve(options.browser || defaultBrowser);
  if (!(await stat(executable)).isFile()) throw new Error('--browser must resolve to a browser executable file');
} catch (error) { console.error(`Readability: ${error.message}\n${help}`); process.exit(2); }

await mkdir(out, { recursive: true });
export const scratch = await mkdtemp(path.join(out, 'work-temp-'));
export const profile = path.join(scratch, 'profile');
if (path.dirname(path.resolve(scratch)) !== out) throw new Error('Scratch path escaped output');
await mkdir(profile, { recursive: true });

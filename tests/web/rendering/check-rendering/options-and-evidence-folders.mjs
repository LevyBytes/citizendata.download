// The check's options, the pages it compares, and the folders it writes: everything it makes, the browser's profile
// included, stays inside --out, in a work-temp- folder it removes when it ends.
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// `folder` is copied whole into each tree, since a page loads files beside it; `stylesheets` is where the
// stylesheets whose properties are read are found. The dashboard is read once it says it is ready, the popup at load.
export const PAGES = {
  dashboard: { folder: "docs", page: "index.html", stylesheets: "docs", ready: "dashboard", widths: [1500, 1300, 1100, 990, 900, 760, 700, 600, 470, 430, 400, 350] },
  popup: { folder: "extension", page: "popup/popup.html", stylesheets: "extension/popup", ready: "load", widths: [400] }
};

const help = `Usage: node tests/web/rendering/check-rendering.mjs --out <evidence-directory> [--reference <commit> | --reference-folder <directory>]
         [--page dashboard|popup]... [--browser <Chrome-executable>]

Checks that the dashboard (docs/index.html) and the extension popup (extension/popup/popup.html) render as they did at
a reference: by default the last commit (HEAD), read from Git without changing anything; or a folder that holds docs/
and extension/ as they were. Every element, with its ::before and ::after, is compared by its box and by the computed
value of every property the pages' stylesheets declare, in headless Chrome, at 12 widths for the dashboard and one for
the popup. The reference is first compared with itself; a page that does not render the same twice is reported, not
compared. The popup is opened as a file, without the extension's APIs, so its first state is what is compared.
--out is required; the report rendering.json and the browser's temporary profile are kept in that folder.
Chrome defaults to its ProgramFiles installation on Windows; other installations and platforms give --browser.
Exit 0: every page renders the same; 1: a page renders differently, or the check could not run; 2: invalid arguments.
`;
if (process.argv.includes("--help") || process.argv.includes("-h")) { console.log(help); process.exit(0); }

const isFolder = async (folder) => (await stat(folder).catch(() => null))?.isDirectory() === true;
const isFile = async (file) => (await stat(file).catch(() => null))?.isFile() === true;

export let outFolder, reference, referenceFolder, pageNames, browserExecutable;
try {
  const options = { out: { type: "string" }, reference: { type: "string" }, "reference-folder": { type: "string" }, page: { type: "string", multiple: true }, browser: { type: "string" } };
  const { values } = parseArgs({ options, strict: true });
  if (!values.out) throw new Error("--out is required");
  if (values.reference && values["reference-folder"]) throw new Error("give --reference or --reference-folder, not both");
  outFolder = path.resolve(values.out);
  reference = values.reference ?? "HEAD";
  referenceFolder = values["reference-folder"] ? path.resolve(values["reference-folder"]) : null;
  if (referenceFolder) {
    for (const folder of ["docs", "extension"]) if (!(await isFolder(path.join(referenceFolder, folder)))) throw new Error(`--reference-folder holds no ${folder} folder`);
  }
  pageNames = [...new Set(values.page ?? Object.keys(PAGES))];
  for (const name of pageNames) if (!Object.hasOwn(PAGES, name)) throw new Error(`--page must be ${Object.keys(PAGES).join(" or ")}, not ${name}`);
  const programFiles = process.platform === "win32" ? process.env.ProgramFiles : undefined;
  browserExecutable = values.browser ?? (programFiles ? path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe") : null);
  if (!browserExecutable) throw new Error("--browser is required for this platform or installation");
  browserExecutable = path.resolve(browserExecutable);
  if (!(await isFile(browserExecutable))) throw new Error("--browser must name an installed executable");
} catch (error) {
  console.error(`Rendering: ${error.message}\n${help}`);
  process.exit(2);
}

await mkdir(outFolder, { recursive: true });
export const scratch = await mkdtemp(path.join(outFolder, "work-temp-"));
if (path.dirname(path.resolve(scratch)) !== outFolder) throw new Error("The scratch folder escaped --out");
export const profile = path.join(scratch, "profile");
await mkdir(profile);

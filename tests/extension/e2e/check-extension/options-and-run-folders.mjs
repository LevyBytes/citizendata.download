import { existsSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromeExecutable } from "../../../support/chrome-test-launch.mjs";

const help = "Usage: node tests/extension/e2e/check-extension.mjs --out <evidence directory> [--browser <Chrome executable>] [--headed] [--only <scenario,...>] [--large] [--open-file <account JSON> [--open-orgs <Orgs JSON>] [--open-zip <Images ZIP>]] "
  + "[--import-recovery <recovery JSON>]";
if (process.argv.includes("--help")) {
  console.log(help);
  process.exit(0);
}

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export let options;
try {
  options = parseArgs({ options: {
    out: { type: "string" }, browser: { type: "string" }, headed: { type: "boolean" }, only: { type: "string" }, large: { type: "boolean" },
    "open-file": { type: "string" }, "open-orgs": { type: "string" }, "open-zip": { type: "string" }, "import-recovery": { type: "string" }
  }, strict: true }).values;
  if (!options.out) throw new Error("--out is required");
} catch (error) {
  console.error(`${error.message}\n${help}`);
  process.exit(2);
}
// Chrome is taken from --browser, then CHROME_PATH, then the usual install locations (tests/support/chrome-test-launch.mjs).
export const executable = chromeExecutable(options.browser ? path.resolve(options.browser) : null);
if (!executable || !existsSync(executable)) {
  console.error(`Chrome was not found. Pass --browser <Chrome executable>.\n${help}`);
  process.exit(2);
}
export const only = options.only ? new Set(options.only.split(",").map((name) => name.trim())) : null;
export const out = path.resolve(options.out);
await mkdir(out, { recursive: true });
export const scratch = await mkdtemp(path.join(out, "extension-temp-"));
export const profile = path.join(scratch, "profile");
export const downloads = path.join(scratch, "downloads");
await mkdir(profile);
await mkdir(downloads);

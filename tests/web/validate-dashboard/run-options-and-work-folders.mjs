import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromeExecutable } from "../../support/chrome-test-launch.mjs";

export const testDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryRoot = path.resolve(testDirectory, "..", "..");
export const profileDirectory = path.join(repositoryRoot, "tests", `work-temp-dashboard-profile-${process.pid}-${Date.now()}`);
export const downloadDirectory = path.join(repositoryRoot, "tests", `work-temp-exports-${process.pid}`);
export const exportReceipts = [];
const browserArgumentIndex = process.argv.indexOf("--browser");
if (browserArgumentIndex >= 0 && (!process.argv[browserArgumentIndex + 1] || process.argv[browserArgumentIndex + 1].startsWith("--"))) throw new Error("--browser requires an absolute executable path.");
// Chrome is taken from --browser, then CHROME_PATH, then the usual install locations (tests/support/chrome-test-launch.mjs).
export const chromePath = chromeExecutable(browserArgumentIndex >= 0 ? path.resolve(process.argv[browserArgumentIndex + 1]) : null) ?? "chrome";
export const captureScreenshots = process.argv.includes("--capture");
export const ccuOnly = process.argv.includes("--ccu-only");
export const supportOnly = process.argv.includes("--support-only");
export const statusOnly = process.argv.includes("--status-only");
export const repairsOnly = process.argv.includes("--repairs-only");
if ([ccuOnly, supportOnly, statusOnly, repairsOnly].filter(Boolean).length > 1) throw new Error('Choose only one focused browser suite.');
if (!profileDirectory.startsWith(`${repositoryRoot}${path.sep}`)) throw new Error("Temporary browser profile escaped the candidate repository.");
export function assertDownloadDirectory() {
  if (path.dirname(path.resolve(downloadDirectory)) !== path.join(repositoryRoot, "tests") || !path.basename(downloadDirectory).startsWith("work-temp-exports-")) throw new Error("Export download cleanup escaped the candidate test directory.");
}
assertDownloadDirectory();
if (!existsSync(chromePath)) throw new Error(`Chromium browser not found at ${chromePath}`);
await rm(profileDirectory, { recursive: true, force: true });
await mkdir(profileDirectory, { recursive: true });
await mkdir(downloadDirectory, { recursive: true });

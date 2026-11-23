import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeTarget } from "../../../scripts/extension-composition.mjs";

await import("../synthetic-rsi.js");
await import("../../../extension/shared/protocol.js");
await import("../../../docs/scripts/request-pacing-settings.js");
await import("../../../docs/scripts/dashboard-model.js");

export const { createSyntheticRsi } = globalThis.CitizenDataSyntheticRsi;
export const Protocol = globalThis.CitizenDataProtocol;
export const Model = globalThis.CitizenDataDashboardModel;
export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// The harness runs the composed Chromium package, as Chrome loads dist/chromium: extension/, platform/chromium/ and
// manifests/chrome.json, each file under its package path (scripts/extension-composition.mjs).
const packageFiles = new Map(composeTarget(repositoryRoot, "chromium").files.map((file) => [file.name, file]));
export const manifest = JSON.parse(packageFiles.get("manifest.json").bytes.toString("utf8"));
export const sources = new Map();

export const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
export const HOSTED_DASHBOARD_URL = "https://citizendata.download/";
export const RSI_TOKEN = "synthetic-session-token-0123456789";
export const STATE_KEY = "citizendata.runtime.v2";
export const WATCHDOG_ALARM = "citizendata.watchdog";

function packageFile(packagePath) {
  const file = packageFiles.get(packagePath);
  if (!file) throw new Error(`The composed Chromium package has no file ${packagePath}.`);
  return file;
}

// The text of one package file.
export function source(packagePath) {
  if (!sources.has(packagePath)) sources.set(packagePath, packageFile(packagePath).bytes.toString("utf8"));
  return sources.get(packagePath);
}

// The repository file a package file came from, so a stack trace names the file to open.
export function sourceFileName(packagePath) {
  return packageFile(packagePath).source;
}

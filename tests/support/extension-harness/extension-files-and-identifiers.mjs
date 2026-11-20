import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("../synthetic-rsi.js");
await import("../../../extension/shared/protocol.js");
await import("../../../docs/scripts/dashboard-model.js");

export const { createSyntheticRsi } = globalThis.CitizenDataSyntheticRsi;
export const Protocol = globalThis.CitizenDataProtocol;
export const Model = globalThis.CitizenDataDashboardModel;
export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const extensionRoot = path.join(repositoryRoot, "extension");
export const manifest = JSON.parse(readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
export const sources = new Map();

export const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
export const HOSTED_DASHBOARD_URL = "https://citizendata.download/";
export const RSI_TOKEN = "synthetic-session-token-0123456789";
export const STATE_KEY = "citizendata.runtime.v2";
export const WATCHDOG_ALARM = "citizendata.watchdog";

export function source(relativePath) {
  if (!sources.has(relativePath)) sources.set(relativePath, readFileSync(path.join(extensionRoot, relativePath), "utf8"));
  return sources.get(relativePath);
}

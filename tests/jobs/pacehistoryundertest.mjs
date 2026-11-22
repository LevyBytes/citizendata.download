// The retained pace history (shared/pace-history.js) and the pace controller in both synced copies, with the
// settings and records the pace history tests build on.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const files = (folder) => ["request-pacing-settings.js", "pace-controller.js", "pace-history.js"].map((name) => path.join(root, ...folder, name));

export const extension = await loadClassicScripts(files(["extension", "shared"]), { crypto: globalThis.crypto, TextEncoder, Uint8Array });

export const History = extension.CitizenDataPaceHistory;

export const settings = extension.CITIZENDATA_REQUEST_PACING;

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const FINGERPRINT = await extension.CitizenDataRequestPacing.settingsFingerprint();

export const T0 = Date.parse("2026-11-21T12:00:00.000Z");

export const at = (ms) => new Date(T0 + ms).toISOString();

export const FAMILY = "GET /account/pledges in pledges";

// The settings with smaller history bounds, so a test reaches them quickly.
export const small = (history) => ({ ...plain(settings), history: { ...settings.history, ...history } });

export function start(runId, startedAt = at(0), accountId = "VerifiedCitizen", fingerprint = FINGERPRINT) {
  return History.startRun({ runId, accountId, runKind: "account", settingsFingerprint: fingerprint, settingsVersion: 1, startedAt, startedFactor: 2 });
}

export const attempt = (outcome, extra = {}) => ({ section: "pledges", requestFamily: FAMILY, outcome, code: outcome === "accepted" ? "OK" : "RSI_HTML_HTTP_429", httpStatus: outcome === "accepted" ? 200 : 429, elapsedMs: 300, factor: 2, ...extra });

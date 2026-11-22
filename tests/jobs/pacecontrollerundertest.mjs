// The pace controller (shared/pace-controller.js) in both synced copies, its settings, and the answers and signals
// the pace controller tests feed it.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const load = async (folder) => loadClassicScripts([path.join(root, ...folder, "request-pacing-settings.js"), path.join(root, ...folder, "pace-controller.js")], { crypto: globalThis.crypto, TextEncoder, Uint8Array });

export const extension = await load(["extension", "shared"]);

export const Pace = extension.CitizenDataPaceController;

export const settings = extension.CITIZENDATA_REQUEST_PACING;

export const T0 = Date.parse("2026-11-21T12:00:00.000Z");

export const ACCOUNT_MAX = 120000 / 900;

export const LIMIT = { kind: "limit", code: "RSI_HTML_HTTP_429", retryAfterMs: null };

export const TIMEOUT = { kind: "transient", code: "RSI_REQUEST_TIMEOUT", retryAfterMs: null };

export const middle = () => 0.5;

export const interval = (baselineMs, factor) => Math.min(settings.brakes.maximumIntervalMs, Math.round(baselineMs * factor));

export const accepted = (pace, nowMs, extra = {}) => Pace.onSuccess(pace, { requestFamily: "POST /api/account/pledgeLog in hangarLog", elapsedMs: 50, historicalNormal: null, nowMs, settings, maxFactor: ACCOUNT_MAX, ...extra });

export const refused = (pace, nowMs, signal = LIMIT) => Pace.onRefusal(pace, signal, { nowMs, random: middle, settings, maxFactor: ACCOUNT_MAX, expiresAtMs: T0 + 6 * 3600000 });

export const close = (actual, expected, digits = 2) => assert.equal(Number(actual.toFixed(digits)), expected, `${actual} is not about ${expected}`);

// Accepted steps back to back at the interval without jitter, from `now`, until `until` returns true.
export function acceptUntil(pace, now, baselineMs, until, limit = 3000) {
  let state = pace;
  let at = now;
  for (let index = 0; index < limit; index += 1) {
    state = accepted(state, at);
    if (until(state, at)) return { pace: state, now: at };
    at += interval(baselineMs, state.factor);
  }
  throw new Error("The condition was never met.");
}

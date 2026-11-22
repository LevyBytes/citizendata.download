// The request pacing settings (shared/request-pacing-settings.js) in both synced copies, each in its own context,
// and a settings copy with one value changed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const load = async (...parts) => (await loadClassicScripts([path.join(root, ...parts)], { crypto: globalThis.crypto, TextEncoder, Uint8Array })).CitizenDataRequestPacing;

export const shared = await load("shared", "request-pacing-settings.js");

export const ORDER = [
  "profile", "hangarLog",
  "financial.balances", "financial.billingTotal", "financial.ledgers", "financial.orders", "financial.subscriptions",
  "pledges", "buybacks",
  "referrals.legacy.recruits", "referrals.current.prospects", "referrals.current.recruits",
  "organizations.memberships", "buybackDetails", "buybackUpgradePrices"
];

// A plain, changeable copy of the settings with one value replaced, and any others the case needs.
export function withValue(keys, value, also = []) {
  const copy = JSON.parse(JSON.stringify(shared.settings));
  for (const [keyPath, replacement] of [[keys, value], ...also]) {
    let target = copy;
    for (const key of keyPath.slice(0, -1)) target = target[key];
    if (replacement === undefined) delete target[keyPath.at(-1)];
    else target[keyPath.at(-1)] = replacement;
  }
  return copy;
}

await import("../../shared/account-document.js");
await import("../../extension/adapters/normalization.js");
await import("../../extension/adapters/pure-parsers.js");

export const Parsers = globalThis.CitizenDataPureParsers;
const observedAt = "2026-11-17T12:00:00.000Z";
export const context = { observedAt };
export const image = { url: "https://media.robertsspaceindustries.com/path/thumb.jpg", role: "thumbnail", altText: "Ship" };
export const money = (amount) => ({ amount, currency: "USD" });
export const identifier = (namespace, value) => ({ namespace, value, source: "rsi" });

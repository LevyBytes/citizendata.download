import { DOMParser } from "../support/mini-dom.mjs";

await import("../../shared/account-document.js");
await import("../../extension/adapters/normalization.js");
await import("../../extension/adapters/pure-parsers.js");
await import("../../extension/adapters/dom-extractors.js");
await import("../support/synthetic-rsi.js");

export const { extractBuybackDetail } = globalThis.CitizenDataDomExtractors;
export const { parseBuybackDetails } = globalThis.CitizenDataPureParsers;
export const { createSyntheticRsi, buildBuybackDetail } = globalThis.CitizenDataSyntheticRsi;
export const ORIGIN = "https://robertsspaceindustries.com";
export const context = { observedAt: "2026-11-19T12:00:00.000Z", parserVersion: "1.0.0" };

export async function shownPage(rsi, id) {
  const response = await rsi.fetch(`${ORIGIN}/pledge/buyback/${id}`);
  return { url: response.url, status: response.status, document: new DOMParser().parseFromString(await response.text(), "text/html") };
}

export function page(body, bodyClass = "pledge sku-detail buy-back extras-type") {
  return new DOMParser().parseFromString(`<!doctype html><html><head><title>t</title></head><body id="store" class="${bodyClass}">${body}</body></html>`, "text/html");
}

export function row(overrides = {}) {
  return {
    buybackId: 20000001, title: "Standalone Ships - Mustang Alpha", categoryLabel: "Standalone Ships", name: "Mustang Alpha", pageType: "extras",
    price: { amount: "25.00", currency: "USD" }, priceText: "$25.00 USD", originalPrice: null, discountPercent: null, discountText: null, priceDataValue: "2500", priceDataCurrency: "USD", skuId: "7001",
    descriptionTitle: "Standalone Ships - Mustang Alpha", description: "First paragraph.\n\nSecond paragraph.",
    ships: [{
      name: "Mustang Alpha", manufacturer: "Consolidated Outland", focus: "Light Fighter", shipPageUrl: `${ORIGIN}/pledge/ships/mustang/Mustang-Alpha`,
      images: [{ url: "https://media.robertsspaceindustries.com/synthetic/ship.jpg", role: "ship", altText: null, width: null, height: null }]
    }],
    alsoContains: ["6 Month Insurance"], images: [{ url: "https://media.robertsspaceindustries.com/synthetic/detail.jpg", role: "detail", altText: "Mustang Alpha", width: null, height: null }],
    buybackTokensAvailable: 2, sourceUrl: `${ORIGIN}/en/pledge/buyback/20000001`, capturedAt: "2026-11-19T11:59:00.000Z",
    ...overrides
  };
}

await import("../../docs/scripts/account-document.js");
await import("../../docs/schema/account-export.schema.js");
await import("../../extension/adapters/update-delta.js");
await import("../../extension/adapters/removal-tracking.js");
await import("../../extension/adapters/document-assembler.js");

export const Assembler = globalThis.CitizenDataDocumentAssembler;
export const AccountDocument = globalThis.CitizenDataAccountDocument;
export const now = "2026-11-17T12:00:00.000Z";
export const account = { localAccountId: "11111111-1111-4111-8111-111111111111", ueeCitizenRecord: 42, handle: "Citizen" };
export const complete = { status: "complete", parserVersion: "1.0.0", startedAt: now, endedAt: now, records: 1, pagesOrBatches: 1, warnings: [] };
export const profile = {
  displayName: "Citizen", handle: "Citizen", displayTitle: null, enlistedOnRaw: null, location: null, languages: [], website: null,
  biography: null, mainOrganizationSid: null, organizationRank: null, dossierBadgeTitle: null, images: [],
  observation: { firstObservedAt: now, lastObservedAt: now, parserVersion: "1.0.0" }
};

export function buyback(buybackId, overrides = {}) {
  return {
    buybackId, recordKey: `buyback:${buybackId}`, kind: "ordinary", category: "standaloneShip", title: `Standalone Ships - Example ${buybackId}`, reclaimDateRaw: "October 1, 2026",
    containsSummary: null, availability: "Available", images: [], sourceLinks: [{ kind: "detail", url: `https://robertsspaceindustries.com/pledge/buyback/${buybackId}`, observedAt: now }],
    sourcePage: 1, state: "available", observation: { firstObservedAt: now, lastObservedAt: now, parserVersion: "1.3.0" }, buybackPrice: null, items: [], catalogIdentifiers: [], upgrade: null,
    ...overrides
  };
}

export function detail(buybackId, amount, capturedAt = now) {
  return {
    buybackId, recordKey: `buyback-detail:${buybackId}`, title: `Standalone Ships - Example ${buybackId}`, categoryLabel: "Standalone Ships", name: `Example ${buybackId}`, pageType: "extras",
    price: amount === null ? null : { amount, currency: "USD" }, priceText: amount === null ? null : `$${amount} USD`, originalPrice: null, discountPercent: null, discountText: null, priceDataValue: null, priceDataCurrency: null,
    skuId: null, descriptionTitle: null, description: null, ships: [], alsoContains: [], images: [], buybackTokensAvailable: 2,
    sourceUrl: `https://robertsspaceindustries.com/en/pledge/buyback/${buybackId}`, capturedAt
  };
}

export const listed = (ids) => ({ section: "buybacks", value: ids.map((id) => buyback(id)), outcome: { ...complete, parserVersion: "1.3.0", records: ids.length } });
export const details = (rows, overrides = {}) => ({ section: "buybackDetails", value: rows, outcome: { ...complete, records: rows.length, ...overrides } });
export const first = { section: "profile", value: profile, outcome: complete };

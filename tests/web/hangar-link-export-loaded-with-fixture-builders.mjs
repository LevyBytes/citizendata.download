await import("../../docs/scripts/hangar-link-ships.js");
await import("../../docs/scripts/compatibility-exports.js");
export const Export = globalThis.CitizenDataHangarLinkExport;
export const shippedTable = globalThis.CitizenDataHangarLinkShips;

// A small ship table, so these tests do not change when the shipped table is rebuilt from a newer catalogue.
export const SHIPS = Object.freeze({
  slugs: ["aurora-mr", "avenger-titan", "gladius", "mustang-omega", "mpuv-cargo", "f7c-m-super-hornet-mk-ii", "f7cm-hornet-heartseeker-mkii"],
  titles: { "aurora mk i mr": "aurora-mr" },
  aliases: { "mustang-omega-amd-edition": "mustang-omega", "mpuv-c": "mpuv-cargo" }
});
export const observedAt = "2026-11-19T00:00:00.000Z";
const observation = { firstObservedAt: observedAt, lastObservedAt: observedAt, parserVersion: "1.1.0" };
let nextId = 41000000;

export function item(name, fields = {}) {
  return { recordKey: `item:${name}`, name, kind: null, manufacturer: null, customName: null, section: "items", category: "other", quantity: 1, images: [], catalogIdentifiers: [], ...fields };
}
export const also = (name) => item(name, { section: "alsoContains" });
export const ship = (name, fields = {}) => item(name, { kind: "Ship", manufacturer: "Example Maker (EXMP)", category: "standaloneShip", ...fields });

export function pledge(fields = {}) {
  const pledgeId = "pledgeId" in fields ? fields.pledgeId : nextId++;
  return {
    pledgeId, recordKey: `pledge:${pledgeId}`, title: "Add-Ons - Example Flair", category: "other", availability: "Attributed", createdDateRaw: "May 09, 2026",
    containsSummary: "Example Flair", items: [], images: [],
    sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/account/pledges?page=1&product-type=", observedAt }], sourcePage: 1,
    state: "current", observation, meltValue: { amount: "10.00", currency: "USD" }, meltEligible: true, giftEligible: false,
    baseValue: { amount: "0.00", currency: "USD" }, ccuHistory: [], catalogIdentifiers: [], ...fields
  };
}

export function buyback(fields = {}) {
  const buybackId = "buybackId" in fields ? fields.buybackId : nextId++;
  return {
    buybackId, recordKey: `buyback:${buybackId}`, kind: "ordinary", category: "other", title: "Add-Ons - Example Flair", reclaimDateRaw: "March 3, 2025",
    containsSummary: "Example Flair", availability: "Available", items: [], images: [],
    sourceLinks: [{ kind: "detail", url: `https://robertsspaceindustries.com/pledge/buyback/${buybackId}`, observedAt }], sourcePage: 1,
    state: "available", observation, buybackPrice: null, catalogIdentifiers: [], upgrade: null, ...fields
  };
}

export const backup = (pledges = [], buybacks = []) => ({ account: { handle: "ExampleCitizen" }, pledges, buybacks });
export const written = (document, inventoryScope = "both") => Export.prepareExport(document, { inventoryScope, ships: SHIPS });
export const hangarRecord = (fields) => written(backup([pledge(fields)])).payload.pledges[0];
export const buybackRecord = (fields) => written(backup([], [buyback(fields)])).payload.pledges[0];

export function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

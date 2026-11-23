import { readFile } from "node:fs/promises";

await import("../../docs/scripts/account-document.js");
await import("../../docs/scripts/hangar-link-ships.js");
await import("../../docs/scripts/compatibility-exports.js");
await import("../../docs/scripts/hangar-link-import.js");
await import("../../docs/scripts/dashboard-model.js");
await import("../../extension/adapters/update-delta.js");
await import("../../extension/adapters/removal-tracking.js");

export const Import = globalThis.CitizenDataHangarLinkImport;
export const Export = globalThis.CitizenDataHangarLinkExport;
export const Documents = globalThis.CitizenDataAccountDocument;
export const Removals = globalThis.CitizenDataRemovalTracking;
export const schema = JSON.parse(await readFile(new URL("../../schema/account-export.schema.json", import.meta.url), "utf8"));

export const IMPORTED_AT = "2026-11-19T12:00:00.000Z";
export const OPTIONS = Object.freeze({ importedAt: IMPORTED_AT, localAccountId: "3f0e8a52-6c1d-4b7a-9e2f-5d4c3b2a1f00", generatorVersion: "0.42.2" });
export const SHIPS = Object.freeze({ slugs: ["aurora-mr", "gladius", "mpuv-cargo"], titles: { "aurora mk i mr": "aurora-mr" }, aliases: {} });

// One record as Hangar Link writes it. Every field is present in its own files.
export function record(fields = {}) {
  return {
    pledgeId: "41000001", name: "Standalone Ships - Aegis Gladius", contains: "Gladius and 2 items", cost: "90.0", configurationCost: "0.0", currency: "USD",
    date: "2016-08-25", insuranceType: "insLTI", warbond: false, giftable: true, meltable: true, package: false, uec: "0.0", pledgeType: "ship",
    hangar: "ExampleCitizen", page: 2, pageOf: 10,
    alsoContains: [{ title: "Lifetime Insurance" }],
    items: [{ itemCustomName: "Night Owl", kind: "Ship", liner: "Aegis Dynamics (AEGS)", title: "Gladius", slug: "gladius" }],
    upgradeFrom: "", upgradeTo: "", buyback: false, buybackHref: null, fromShipId: null, toShipId: null, toSkuId: null,
    ...fields
  };
}
export const boughtBack = (fields = {}) => record({
  pledgeId: "21000001", name: "Add-Ons - Example Flair", contains: "Example Flair", cost: "5.0", insuranceType: "insNone", giftable: false, meltable: false, pledgeType: "other",
  page: 3, pageOf: 100, alsoContains: [], items: [], buyback: true, buybackHref: "/pledge/buyback/21000001", fromShipId: "", toShipId: "", toSkuId: "", ...fields
});
export const upgradeBuyback = (fields = {}) => boughtBack({
  pledgeId: "21000002", name: "Ship Upgrades - Aurora MR to Gladius Upgrade", contains: "Aurora MR to Gladius Upgrade", cost: "0.0", pledgeType: "upgrade",
  buybackHref: "", fromShipId: "101", toShipId: "202", toSkuId: "303", upgradeFrom: "aurora-mr", upgradeTo: "gladius", ...fields
});
export const file = (...pledges) => ({ type: "hangarlink", version: 1, pledges });
export const opened = (...pledges) => Import.toAccountDocument(file(...pledges), OPTIONS);

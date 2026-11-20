import assert from "node:assert/strict";

await import("../../docs/scripts/account-document.js");
await import("../../docs/schema/account-export.schema.js");
await import("../support/synthetic-rsi.js");
export const AccountDocument = globalThis.CitizenDataAccountDocument;
const { upgradePriceCents } = globalThis.CitizenDataSyntheticRsi;

// One in four buy-backs is a CCU. The six CCU buy-backs of this account are two different CCUs, three of each.
export const SMALL = { counts: { pledges: 12, buybacks: 24, orders: 5, storeCredit: 5, uec: 3, rec: 2, olderHangarLogRows: 5, prospects: 5, recruits: 2, legacyRecruits: 1, organizationMembers: 5 } };
export const AUTH = "/api/account/v2/setAuthToken";
export const CONTEXT = "/api/ship-upgrades/setContextToken";
export const PRICE = "/pledge-store/api/upgrade/graphql";

const plain = (value) => JSON.parse(JSON.stringify(value));
export const resultOf = (tab) => plain(tab.events.filter((event) => event.result).at(-1)?.result ?? null);
export const calls = (requests, path) => requests.filter((request) => request.path === path).length;
// Calls that open the session, calls that name an upgrade, requests that ask a price, and how many of those also
// ask for the list of ships.
export const upgradeCalls = (requests) => [calls(requests, AUTH), calls(requests, CONTEXT), calls(requests, PRICE), requests.filter((request) => request.path === PRICE && request.operations.includes("ships")).length];
// RSI's larger image of a ship, and its small one.
export const shipImage = (id) => `https://media.robertsspaceindustries.com/synthetic/upgrade-ship-${id}-large.jpg`;
export const smallShipImage = (id) => `https://media.robertsspaceindustries.com/synthetic/upgrade-ship-${id}.jpg`;
// The images a CCU buy-back carries of the ship it starts from and of the ship it leads to.
export const sourceOf = (record) => record.images.find((image) => image.role === "upgrade-source")?.url ?? null;
export const destinationOf = (record) => record.images.find((image) => image.role === "upgrade-destination")?.url ?? null;
export const ccus = (rsi) => rsi.state.buybacks.filter((buyback) => buyback.upgrade);
export const priceOf = (buyback, rise = 0) => ({ amount: ((upgradePriceCents(Number(buyback.upgrade.fromShipId), Number(buyback.upgrade.toSkuId)) + rise) / 100).toFixed(2), currency: "USD" });
export const shown = (document) => Object.fromEntries(document.buybacks.filter((record) => record.kind === "upgrade").map((record) => [record.buybackId, record.buybackPrice]));

export async function build(harness, tab) {
  tab.reload();
  const started = await tab.build();
  assert.equal(started.code, "RUN_STARTED", started.message);
  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete", JSON.stringify((await tab.status()).activeJob?.failure));
  await harness.advanceBy(60000);
  const document = resultOf(tab);
  assert.equal(await AccountDocument.verifyIntegrity(structuredClone(document)), true);
  AccountDocument.assertValid(structuredClone(document), globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
  return document;
}

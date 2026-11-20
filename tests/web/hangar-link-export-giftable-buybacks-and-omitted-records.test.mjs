import assert from "node:assert/strict";
import test from "node:test";
import { backup, buyback, buybackRecord, hangarRecord, observedAt, pledge, written } from "./hangar-link-export-loaded-with-fixture-builders.mjs";

test("a pledge is giftable only when RSI offers the gift button and its value allows it", () => {
  const giftable = (giftEligible, amount) => hangarRecord({ giftEligible, meltValue: { amount, currency: "USD" } }).giftable;
  assert.equal(giftable(true, "45.00"), true);
  assert.equal(giftable(true, "1000.00"), true);
  assert.equal(giftable(true, "1000.01"), false);
  assert.equal(giftable(false, "45.00"), false);
  assert.equal(giftable(null, "45.00"), false);
  assert.equal(hangarRecord({ meltEligible: true }).meltable, true);
  assert.equal(hangarRecord({ meltEligible: false }).meltable, false);
  assert.equal(hangarRecord({ meltEligible: null }).meltable, false);
  // Hangar Link's own files carry false for every record.
  assert.equal(hangarRecord({ title: "Standalone Ships - Gladius - Warbond" }).warbond, false);
});

test("a buy-back is written with its page link, or with the numbers of its upgrade", () => {
  const ordinary = buybackRecord({ buybackId: 21234567, title: "Standalone Ships - Gladius", containsSummary: "Gladius and 1 item", reclaimDateRaw: "March 3, 2025", sourcePage: 4 });
  assert.deepEqual(ordinary, {
    pledgeId: "21234567", name: "Standalone Ships - Gladius", contains: "Gladius and 1 item", cost: "0.0", configurationCost: "0.0", currency: "USD", date: "2025-03-03",
    insuranceType: "insNone", warbond: false, giftable: false, meltable: false, package: false, uec: "0.0", pledgeType: "ship", hangar: "ExampleCitizen", page: 4, pageOf: 100,
    alsoContains: [], items: [], upgradeFrom: "", upgradeTo: "", buyback: true, buybackHref: "/pledge/buyback/21234567", fromShipId: "", toShipId: "", toSkuId: ""
  });

  const upgrade = buybackRecord({
    buybackId: 21234999, kind: "upgrade", title: "Upgrade - Aurora MR to Gladius Standard Edition", containsSummary: "Aurora MR to Gladius Upgrade",
    sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/account/buy-back-pledges?page=2&pagesize=100", observedAt }], sourcePage: 2,
    upgrade: { fromShipIdentifiers: [{ namespace: "ship", value: "37", source: "rsi" }], toShipIdentifiers: [{ namespace: "ship", value: "112", source: "rsi" }], skuIdentifiers: [{ namespace: "sku", value: "5012", source: "rsi" }] }
  });
  assert.deepEqual([upgrade.buybackHref, upgrade.fromShipId, upgrade.toShipId, upgrade.toSkuId], ["", "37", "112", "5012"]);
  assert.deepEqual([upgrade.pledgeType, upgrade.upgradeFrom, upgrade.upgradeTo, upgrade.page], ["upgrade", "aurora-mr", "gladius", 2]);

  // An upgrade by name that RSI lists like any other pledge keeps its page link.
  const named = buybackRecord({ buybackId: 21235000, kind: "upgrade", title: "Upgrade - Aurora MR to Gladius Standard Edition", upgrade: { fromShipIdentifiers: [], toShipIdentifiers: [], skuIdentifiers: [] } });
  assert.deepEqual([named.buybackHref, named.fromShipId, named.toShipId, named.toSkuId], ["/pledge/buyback/21235000", "", "", ""]);
});

test("buy-back prices are written when the backup has them, and their absence is said once", () => {
  const priced = written(backup([], [buyback({ buybackPrice: { amount: "65.00", currency: "USD" } }), buyback()]));
  assert.deepEqual(priced.payload.pledges.map((record) => record.cost), ["65.0", "0.0"]);
  assert.deepEqual(priced.warnings, ["1 buy-back with no recorded price is written with a cost of 0."]);
  const unpriced = written(backup([pledge()], [buyback(), buyback()]));
  assert.deepEqual(unpriced.warnings, ["This backup holds no buy-back prices, so buy-backs are written with a cost of 0. Build it again with the extension to record them."]);
  assert.deepEqual(written(backup([pledge()], [buyback()]), "hangar").warnings, []);
  // An upgrade's price is never recorded, which is said apart from a price that is merely missing.
  const upgrade = { buybackId: 21234999, kind: "upgrade", title: "Upgrade - Aurora MR to Gladius Standard Edition", containsSummary: "Aurora MR to Gladius Upgrade" };
  const mixed = written(backup([], [buyback({ buybackPrice: { amount: "65.00", currency: "USD" } }), buyback(upgrade)]));
  assert.deepEqual(mixed.payload.pledges.map((record) => record.cost), ["65.0", "0.0"]);
  assert.deepEqual(mixed.warnings, ["1 upgrade buy-back is written with a cost of 0."]);
});

test("records that cannot be written are left out, counted, and never invented", () => {
  const result = written(backup([
    pledge({ pledgeId: 41000001 }),
    pledge({ pledgeId: null }),
    pledge({ createdDateRaw: null }),
    pledge({ createdDateRaw: "sometime in 2019" }),
    pledge({ state: "historical" }),
    pledge({ state: "missing-unresolved" })
  ], [
    buyback({ buybackId: 21000001, state: "unavailable" }),
    buyback({ buybackId: null }),
    buyback({ state: "historical" })
  ]));
  assert.deepEqual(result.payload.pledges.map((record) => record.pledgeId), ["41000001", "21000001"]);
  assert.equal(result.recordCount, 2);
  assert.equal(result.warnings[0], "Left out: 2 records without an RSI pledge number, 2 records without a readable date, 3 records RSI no longer lists.");

  // When nothing can be written there is no file, and the reason is given.
  assert.throws(() => written(backup([pledge({ pledgeId: null })], [buyback({ buybackId: null })])), { message: "Nothing can be written for Hangar Link. Left out: 2 records without an RSI pledge number." });
  assert.throws(() => written(backup([pledge()], []), "buybacks"), { message: "The selected lists are empty, so there is nothing to write for Hangar Link." });
  assert.throws(() => written(backup()), /nothing to write/u);
});

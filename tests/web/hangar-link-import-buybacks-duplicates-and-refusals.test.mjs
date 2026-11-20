import assert from "node:assert/strict";
import test from "node:test";
import { IMPORTED_AT, Import, OPTIONS, boughtBack, file, opened, record, upgradeBuyback } from "./hangar-link-import-loaded-with-fixture-records.mjs";

test("a buy-back is listed with its own page, and an upgrade with the numbers RSI's upgrade tool needs", () => {
  const { buybacks } = opened(boughtBack(), upgradeBuyback({ cost: "50.0" })).document;
  assert.deepEqual(buybacks[0], {
    buybackId: 21000001,
    recordKey: "buyback:21000001",
    kind: "ordinary",
    category: "hangarItem",
    title: "Add-Ons - Example Flair",
    reclaimDateRaw: "August 25, 2016",
    containsSummary: "Example Flair",
    availability: null,
    images: [],
    sourceLinks: [{ kind: "detail", url: "https://robertsspaceindustries.com/pledge/buyback/21000001", observedAt: IMPORTED_AT }],
    sourcePage: 3,
    state: "available",
    observation: { firstObservedAt: IMPORTED_AT, lastObservedAt: IMPORTED_AT, parserVersion: "hangar-link-import-1" },
    buybackPrice: { amount: "5.00", currency: "USD" },
    items: [],
    catalogIdentifiers: [],
    upgrade: null
  });
  assert.equal(buybacks[1].kind, "upgrade");
  // The category is read from the name exactly as the extension reads a title on RSI's page, so a name that starts
  // with "Ship Upgrades" is classed here as it is in a build.
  assert.equal(buybacks[1].category, "standaloneShip");
  assert.equal(opened(upgradeBuyback({ name: "Upgrade - Aurora MR to Gladius" })).document.buybacks[0].category, "shipUpgrade");
  // An upgrade's price changes, so CitizenData never records one, whatever the file holds.
  assert.equal(buybacks[1].buybackPrice, null);
  assert.deepEqual(buybacks[1].sourceLinks.map((link) => [link.kind, link.url]), [["listing", "https://robertsspaceindustries.com/account/buy-back-pledges?page=3&pagesize=100"]]);
  assert.deepEqual(buybacks[1].upgrade, {
    fromShipIdentifiers: [{ namespace: "ship", value: "101", source: "rsi" }],
    toShipIdentifiers: [{ namespace: "ship", value: "202", source: "rsi" }],
    skuIdentifiers: [{ namespace: "sku", value: "303", source: "rsi" }]
  });
});

test("a record the file holds twice is read once, and an unreadable record is left out and counted", () => {
  const { document, counts } = opened(
    record(), boughtBack(), boughtBack(), upgradeBuyback(), upgradeBuyback(),
    // The same number in the hangar and in the buy-backs is two different records.
    record({ pledgeId: "21000001" }),
    record({ pledgeId: "not a number" }), record({ pledgeId: "41000009", name: "  " }), record({ pledgeId: "41000010", date: "2016-02-30" }),
    record({ pledgeId: "41000011", hangar: "" }), record({ pledgeId: "41000012", buyback: "no" }), null, "text"
  );
  assert.deepEqual(counts, { hangar: 2, buybacks: 2, repeated: 2, leftOut: 7 });
  assert.deepEqual(document.pledges.map((pledge) => pledge.pledgeId), [41000001, 21000001]);
  assert.deepEqual(document.buybacks.map((buyback) => buyback.buybackId), [21000001, 21000002]);
  assert.deepEqual([document.sync.sectionOutcomes.pledges.records, document.sync.sectionOutcomes.buybacks.records], [2, 2]);
});

test("a file CitizenData cannot open as one account is refused with the reason", () => {
  assert.throws(() => Import.toAccountDocument({ type: "hangarlink", version: 2, pledges: [record()] }, OPTIONS), /version 2\. CitizenData reads version 1/u);
  assert.throws(() => Import.toAccountDocument({ type: "hangarlink", pledges: [record()] }, OPTIONS), /version unknown/u);
  assert.throws(() => opened(record(), boughtBack({ hangar: "SomeoneElse" })), /more than one RSI account/u);
  assert.throws(() => opened(), /holds no records/u);
  assert.throws(() => opened(record({ pledgeId: "" })), /No record in this Hangar Link file could be read/u);
  assert.throws(() => Import.toAccountDocument({ schemaVersion: 1, pledges: [] }, OPTIONS), /not a Hangar Link file/u);
  assert.throws(() => Import.toAccountDocument(file(record()), { ...OPTIONS, importedAt: "yesterday" }), TypeError);
});

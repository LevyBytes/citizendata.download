import assert from "node:assert/strict";
import test from "node:test";
import { Export, also, backup, buyback, hangarRecord, item, pledge, ship, written } from "./hangar-link-export-loaded-with-fixture-builders.mjs";

test("the file is the one list Hangar Link and Fleetview import, with the chosen sources in it", () => {
  const document = backup([pledge(), pledge()], [buyback(), buyback(), buyback()]);
  const both = written(document, "both");
  assert.deepEqual(Object.keys(both.payload), ["type", "version", "pledges"]);
  assert.equal(both.payload.type, "hangarlink");
  assert.equal(both.payload.version, 1);
  assert.equal(both.recordCount, 5);
  assert.deepEqual(both.payload.pledges.map((record) => record.buyback), [false, false, true, true, true]);
  assert.deepEqual(both.payload.pledges.map((record) => record.pageOf), [10, 10, 100, 100, 100]);
  assert.ok(both.payload.pledges.every((record) => record.hangar === "ExampleCitizen"));
  // Every record has the same 26 fields in the order Hangar Link writes them.
  assert.equal(Export.FIELD_ORDER.length, 26);
  for (const record of both.payload.pledges) assert.deepEqual(Object.keys(record), [...Export.FIELD_ORDER]);

  assert.deepEqual(written(document, "hangar").payload.pledges.map((record) => record.buyback), [false, false]);
  assert.deepEqual(written(document, "buybacks").payload.pledges.map((record) => record.buyback), [true, true, true]);
  assert.throws(() => written(document, "everything"), /valid compatibility inventory scope/u);
  assert.throws(() => Export.prepareExport(null), /valid compatibility inventory scope/u);
  assert.throws(() => written({ ...document, account: {} }), /does not name its RSI account/u);
});

test("a hangar pledge is written with everything the backup recorded for it", () => {
  const record = hangarRecord({
    pledgeId: 41234567,
    title: "Package - Aurora MR Starter Pack",
    createdDateRaw: "May 09, 2026",
    containsSummary: "Aurora MR and 4 items",
    meltValue: { amount: "45.00", currency: "USD" },
    baseValue: { amount: "40.00", currency: "USD" },
    meltEligible: true,
    giftEligible: true,
    sourcePage: 7,
    items: [
      ship("Aurora MR", { manufacturer: "Roberts Space Industries (RSI)", customName: "Night Owl" }),
      item("Self-Land Hangar", { kind: "Hangar decoration" }),
      also("Star Citizen Digital Download"),
      also("6 Month Insurance"),
      also("Starting Money: 5,000 UEC")
    ]
  });
  assert.deepEqual(record, {
    pledgeId: "41234567",
    name: "Package - Aurora MR Starter Pack",
    contains: "Aurora MR and 4 items",
    cost: "45.0",
    configurationCost: "40.0",
    currency: "USD",
    date: "2026-05-09",
    insuranceType: "ins6",
    warbond: false,
    giftable: true,
    meltable: true,
    package: true,
    uec: "5000.0",
    pledgeType: "ship",
    hangar: "ExampleCitizen",
    page: 7,
    pageOf: 10,
    alsoContains: [{ title: "Star Citizen Digital Download" }, { title: "6 Month Insurance" }, { title: "Starting Money: 5,000 UEC" }],
    items: [
      { itemCustomName: "Night Owl", kind: "Ship", liner: "Roberts Space Industries (RSI)", title: "Aurora MR", slug: "aurora-mr" },
      { itemCustomName: "", kind: "Hangar decoration", liner: "", title: "Self-Land Hangar", slug: "" }
    ],
    upgradeFrom: "",
    upgradeTo: "",
    buyback: false,
    buybackHref: null,
    fromShipId: null,
    toShipId: null,
    toSkuId: null
  });
});

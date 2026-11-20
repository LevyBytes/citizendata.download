import assert from "node:assert/strict";
import test from "node:test";
import { Parsers, context, identifier, image, money } from "./pure-parsers-under-test.mjs";

test("inventory parsers preserve exact money, identifiers, zero CCUs, and buyback contents", async () => {
  const pledges = await Parsers.parsePledges([{
    pledgeId: 42,
    title: "Upgraded package",
    category: "gamePackage",
    createdDateRaw: "October 18, 2012",
    containsSummary: "One ship",
    items: [{ name: "Ship", category: "standaloneShip", quantity: 1, images: [image], relatedUrls: ["https://robertsspaceindustries.com/pledge/ships/example"], catalogIdentifiers: [identifier("rsi.shipSlug", "ship")] }],
    images: [image],
    meltValue: money("0.00"),
    meltEligible: true,
    baseValue: money("100.00"),
    catalogIdentifiers: [identifier("rsi.pledgeId", "42")],
    relatedUrls: ["https://robertsspaceindustries.com/en/account/pledges?page=1&product-type="],
    ccuHistory: [{
      fromShip: "Base ship",
      toShip: "Target ship",
      appliedDateRaw: "November 17, 2026",
      cost: money("0.00"),
      cumulativeValue: money("100.00"),
      sourceEventKeys: ["a".repeat(64) + ":1"]
    }]
  }], context, { sourceUrls: ["https://robertsspaceindustries.com/en/account/pledges?page=1&product-type="] });
  assert.equal(pledges.section, "pledges");
  assert.equal(pledges.value[0].meltValue.amount, "0.00");
  assert.equal(pledges.value[0].ccuHistory[0].cost.amount, "0.00");
  assert.match(pledges.value[0].ccuHistory[0].stepKey, /^ccu-step:/u);
  assert.equal(pledges.value[0].items[0].catalogIdentifiers[0].value, "ship");
  assert.equal(pledges.value[0].images[0].imageKey.length, 64);
  assert.deepEqual(pledges.value[0].items[0].relatedUrls, ["https://robertsspaceindustries.com/pledge/ships/example"]);
  assert.deepEqual(pledges.value[0].observation.relatedUrls, ["https://robertsspaceindustries.com/en/account/pledges?page=1&product-type="]);
  assert.deepEqual(pledges.outcome.sourceUrls, ["https://robertsspaceindustries.com/en/account/pledges?page=1&product-type="]);

  const buybacks = await Parsers.parseBuybacks([{
    buybackId: 7,
    kind: "upgrade",
    category: "shipUpgrade",
    title: "Upgrade",
    reclaimDateRaw: "May 19, 2026",
    containsSummary: "Upgrade",
    items: [],
    images: [],
    buybackPrice: money("5.00"),
    catalogIdentifiers: [],
    upgrade: {
      fromShipIdentifiers: [identifier("rsi.shipId", "1")],
      toShipIdentifiers: [identifier("rsi.shipId", "2")],
      skuIdentifiers: [identifier("rsi.skuId", "3")]
    }
  }], context);
  assert.equal(buybacks.value[0].buybackPrice.amount, "5.00");
  assert.equal(buybacks.value[0].upgrade.toShipIdentifiers[0].value, "2");
});

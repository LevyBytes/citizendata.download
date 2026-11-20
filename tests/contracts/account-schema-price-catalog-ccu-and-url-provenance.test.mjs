import assert from "node:assert/strict";
import test from "node:test";
import { baseAccountDocument, observation, observedAt } from "../fixtures/account-document.mjs";
import { accountSchema, api } from "./account-document-contract-under-test.mjs";

test("schema accepts price, catalog, CCU, and URL provenance fields", async () => {
  const document = baseAccountDocument();
  document.pledges.push({
    pledgeId: 123,
    recordKey: "pledge:123",
    title: "Package - Weekend Warrior - LTI",
    category: "gamePackage",
    availability: "attributed",
    createdDateRaw: "October 22, 2013",
    containsSummary: "Contains one ship",
    items: [{
      recordKey: "pledge:123:item:1",
      name: "F7C-M Hornet Heartseeker Mk I",
      kind: "Ship",
      category: "standaloneShip",
      quantity: 1,
      images: [],
      relatedUrls: ["https://robertsspaceindustries.com/pledge/ships/example"],
      catalogIdentifiers: [{ namespace: "rsi-ship-id", value: "1234", source: "rsi" }]
    }],
    images: [],
    sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/en/account/pledges", observedAt }],
    state: "current",
    observation: { ...observation(), relatedUrls: ["https://robertsspaceindustries.com/en/account/pledges?page=1&product-type="] },
    meltValue: { amount: "185.00", currency: "USD" },
    meltEligible: true,
    baseValue: { amount: "165.00", currency: "USD" },
    ccuHistory: [{
      stepKey: "pledge:123:ccu:1",
      fromShip: "F7C-M Super Hornet",
      toShip: "F7C-M Hornet Heartseeker Mk I",
      appliedDateRaw: "February 12, 2021",
      cost: { amount: "20.00", currency: "USD" },
      cumulativeValue: { amount: "185.00", currency: "USD" },
      sourceEventKeys: ["event:abc:1"]
    }],
    catalogIdentifiers: [{ namespace: "rsi-pledge-id", value: "123", source: "rsi" }]
  });
  document.sync.sectionOutcomes.pledges.sourceUrls = ["https://robertsspaceindustries.com/en/account/pledges?page=1&product-type="];
  document.buybacks.push({
    buybackId: 456,
    recordKey: "buyback:456",
    kind: "ordinary",
    category: "weapon",
    title: "Custodian SMG",
    reclaimDateRaw: "October 27, 2017",
    containsSummary: "Contains one weapon",
    availability: "available",
    images: [],
    sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/en/account/buy-back-pledges", observedAt }],
    state: "available",
    observation: observation(),
    buybackPrice: { amount: "5.00", currency: "USD" },
    items: [],
    catalogIdentifiers: [],
    upgrade: null
  });
  const stamped = await api.stampIntegrity(document);
  assert.equal(api.validateWithSchema(stamped, accountSchema).valid, true);

  const invalidUrl = structuredClone(stamped);
  invalidUrl.profile.observation.relatedUrls = ["http://example.com/not-https"];
  assert.equal(api.validateWithSchema(invalidUrl, accountSchema).valid, false);
});

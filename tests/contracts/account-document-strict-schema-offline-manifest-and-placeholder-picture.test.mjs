import assert from "node:assert/strict";
import test from "node:test";
import { baseAccountDocument, observation, observedAt } from "../fixtures/account-document.mjs";
import { accountSchema, api, offlineSchema } from "./account-document-contract-under-test.mjs";

test("strict schema rejects unknown properties and malformed CCU money", async () => {
  const unknown = await api.stampIntegrity(baseAccountDocument());
  unknown.profile.unapproved = true;
  const unknownResult = api.validateWithSchema(unknown, accountSchema);
  assert.equal(unknownResult.valid, false);
  assert.ok(unknownResult.errors.some((error) => error.keyword === "additionalProperties"));

  const ccu = baseAccountDocument();
  ccu.pledges.push({
    pledgeId: null,
    recordKey: "pledge:test",
    title: "Test",
    category: "unknown",
    availability: null,
    createdDateRaw: null,
    containsSummary: null,
    items: [],
    images: [],
    sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/account/pledges", observedAt }],
    state: "current",
    observation: observation(),
    ccuHistory: [{
      stepKey: "step:1",
      fromShip: "A",
      toShip: "B",
      appliedDateRaw: null,
      cost: { amount: "free", currency: "USD" },
      cumulativeValue: null,
      sourceEventKeys: []
    }]
  });
  const ccuResult = api.validateWithSchema(ccu, accountSchema);
  assert.equal(ccuResult.valid, false);
  assert.ok(ccuResult.errors.some((error) => error.path.endsWith("/cost") || error.path.endsWith("/amount")));
});

test("offline manifest accepts completed UI media entity types", () => {
  const entitySchema = offlineSchema.$defs.entityReference;
  for (const recordType of ["profile", "organization", "organizationMember", "referral", "subscription"]) {
    assert.equal(api.validateWithSchema({ recordType, recordKey: "record:1", role: "avatar" }, entitySchema, { rootSchema: offlineSchema }).valid, true);
  }
  assert.equal(api.validateWithSchema({ recordType: "secret", recordKey: "record:1", role: "avatar" }, entitySchema, { rootSchema: offlineSchema }).valid, false);
});

test("RSI's placeholder picture is told from an image of a record, and taken out of every list of images", () => {
  const placeholder = "https://cdn.robertsspaceindustries.com/static/images/Temp/default-image.png";
  for (const value of [placeholder, { url: placeholder }, { sourceUrl: `${placeholder}?v=2` }, { url: "https://robertsspaceindustries.com/static/images/Temp/default-image.png" }]) assert.equal(api.isPlaceholderImage(value), true);
  for (const value of [
    null, {}, { url: null }, "https://media.robertsspaceindustries.com/abc/store_small/ship.jpg", "https://example.org/static/images/Temp/default-image.png",
    "https://cdn.robertsspaceindustries.com/static/images/Temp/default-image.png.jpg"
  ]) assert.equal(api.isPlaceholderImage(value), false);
  const ship = { url: "https://media.robertsspaceindustries.com/abc/store_small/ship.jpg" };
  const document = { pledges: [{ images: [{ url: placeholder }, ship], items: [{ images: [{ url: placeholder }] }] }], buybacks: [{ images: [ship] }], profile: { images: [] } };
  assert.equal(api.removePlaceholderImages(document), document);
  assert.deepEqual(document, { pledges: [{ images: [ship], items: [{ images: [] }] }], buybacks: [{ images: [ship] }], profile: { images: [] } });
});

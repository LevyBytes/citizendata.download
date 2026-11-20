import assert from "node:assert/strict";
import test from "node:test";
import { ORIGIN, context, parseBuybackDetails, row } from "./buyback-detail-extractor-and-parser-loaded-with-fixture-pages.mjs";

test("a captured detail is recorded with its capture time and the address that answered", async () => {
  const parsed = await parseBuybackDetails([row()], context, { pagesOrBatches: 1 });
  assert.equal(parsed.section, "buybackDetails");
  assert.deepEqual([parsed.outcome.status, parsed.outcome.records, parsed.outcome.parserVersion], ["complete", 1, "1.0.0"]);
  const [detail] = JSON.parse(JSON.stringify(parsed.value));
  assert.deepEqual({ ...detail, images: detail.images.map((image) => [image.role, image.url, image.altText]), ships: detail.ships.map((ship) => ({ ...ship, images: ship.images.map((image) => [image.role, image.url, image.altText]) })) }, {
    buybackId: 20000001, recordKey: "buyback-detail:20000001", title: "Standalone Ships - Mustang Alpha", categoryLabel: "Standalone Ships", name: "Mustang Alpha", pageType: "extras",
    price: { amount: "25.00", currency: "USD" }, priceText: "$25.00 USD", originalPrice: null, discountPercent: null, discountText: null, priceDataValue: "2500", priceDataCurrency: "USD", skuId: "7001",
    descriptionTitle: "Standalone Ships - Mustang Alpha", description: "First paragraph.\n\nSecond paragraph.",
    ships: [{
      name: "Mustang Alpha", manufacturer: "Consolidated Outland", focus: "Light Fighter", shipPageUrl: `${ORIGIN}/pledge/ships/mustang/Mustang-Alpha`,
      images: [["ship", "https://media.robertsspaceindustries.com/synthetic/ship.jpg", "Mustang Alpha"]]
    }],
    alsoContains: ["6 Month Insurance"], images: [["detail", "https://media.robertsspaceindustries.com/synthetic/detail.jpg", "Mustang Alpha"]],
    buybackTokensAvailable: 2, sourceUrl: `${ORIGIN}/en/pledge/buyback/20000001`, capturedAt: "2026-11-19T11:59:00.000Z"
  });
});

test("a page the collector could not read is not a detail, and a page without a price is one", async () => {
  const parsed = await parseBuybackDetails([
    { buybackId: 20000002, unavailable: true, reason: "HTTP_404", capturedAt: "2026-11-19T11:59:00.000Z" },
    row({ price: null, priceText: null, priceDataValue: null, priceDataCurrency: null })
  ], context);
  assert.deepEqual(parsed.value.map((detail) => [detail.buybackId, detail.price]), [[20000001, null]]);
  assert.equal(parsed.outcome.records, 1);
});

test("a detail must name its own buy-back's page on RSI and hold values of the right kind", async () => {
  const rejected = async (overrides, pattern) => assert.rejects(parseBuybackDetails([row(overrides)], context), pattern);
  await rejected({ sourceUrl: `${ORIGIN}/en/pledge/buyback/20000009` }, /is not the page of buy-back 20000001/u);
  await rejected({ sourceUrl: "https://example.com/pledge/buyback/20000001" }, /is not the page of buy-back/u);
  await rejected({ sourceUrl: `${ORIGIN}/pledge/buyback/20000001?add=1` }, /is not the page of buy-back/u);
  await rejected({ buybackId: 0 }, /buybackId must be a safe integer of at least 1/u);
  await rejected({ title: "" }, /title must be nonempty text/u);
  await rejected({ price: { amount: "25", currency: "dollars" } }, /currency/u);
  await rejected({ discountPercent: 140 }, /discountPercent/u);
  await rejected({ capturedAt: "yesterday" }, /capturedAt/u);
  await assert.rejects(parseBuybackDetails([row(), row()], context), /recordKey values must be unique/u);
  // The page is accepted with or without the language prefix.
  assert.equal((await parseBuybackDetails([row({ sourceUrl: `${ORIGIN}/pledge/buyback/20000001` })], context)).value[0].sourceUrl, `${ORIGIN}/pledge/buyback/20000001`);
});

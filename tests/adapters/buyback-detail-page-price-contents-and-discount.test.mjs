import assert from "node:assert/strict";
import test from "node:test";
import { ORIGIN, buildBuybackDetail, createSyntheticRsi, extractBuybackDetail, shownPage } from "./buyback-detail-extractor-and-parser-loaded-with-fixture-pages.mjs";

test("a buy-back page gives its price, contents, ships, and images as shown", async () => {
  const rsi = createSyntheticRsi();
  // Buy-back 1 is a standalone ship at its list price, with a ship card.
  const shown = buildBuybackDetail(rsi.state.buybacks[1]);
  const { url, document } = await shownPage(rsi, shown.id);
  assert.equal(url, `${ORIGIN}/en/pledge/buyback/${shown.id}`, "RSI answers a buy-back link under its language prefix");
  const detail = extractBuybackDetail(document, { baseUrl: url });
  assert.deepEqual(detail, {
    recognized: true,
    title: shown.title,
    categoryLabel: "Standalone Ships",
    name: shown.name,
    pageType: "extras",
    price: { amount: (shown.cents / 100).toFixed(2), currency: "USD" },
    priceText: `$${(shown.cents / 100).toFixed(2)} USD`,
    originalPrice: null,
    discountPercent: null,
    discountText: null,
    priceDataValue: String(shown.cents),
    priceDataCurrency: "USD",
    skuId: String(shown.sku),
    descriptionTitle: shown.title,
    description: shown.description.join("\n\n"),
    ships: [{
      name: shown.ships[0].name,
      manufacturer: shown.ships[0].manufacturer,
      focus: shown.ships[0].focus,
      shipPageUrl: `${ORIGIN}${shown.ships[0].page}`,
      images: [{ url: `https://media.robertsspaceindustries.com/synthetic/buyback-ship-${shown.sku}-0.jpg`, role: "ship", altText: null, width: null, height: null }]
    }],
    alsoContains: shown.alsoContains,
    images: [{ url: `https://media.robertsspaceindustries.com/synthetic/buyback-detail-${shown.sku}.jpg`, role: "detail", altText: shown.name, width: null, height: null }],
    buybackTokensAvailable: 2
  });
});

test("a discount is recorded as the page shows it: the price, the price before it, and the saving", async () => {
  const rsi = createSyntheticRsi();
  // Buy-back 0 is a game package at 15% off; buy-back 5 is a ship at 25% off and has no ship card.
  for (const index of [0, 5]) {
    const shown = buildBuybackDetail(rsi.state.buybacks[index]);
    assert.ok(shown.originalCents !== null);
    const { url, document } = await shownPage(rsi, shown.id);
    const detail = extractBuybackDetail(document, { baseUrl: url });
    assert.deepEqual([detail.price, detail.originalPrice, detail.discountPercent, detail.discountText], [
      { amount: (shown.cents / 100).toFixed(2), currency: "USD" },
      { amount: (shown.originalCents / 100).toFixed(2), currency: "USD" },
      shown.discountPercent,
      `Save ${shown.discountPercent}%`
    ], `buy-back ${index}`);
    assert.equal(detail.pageType, index === 0 ? "game-packages" : "extras");
    assert.equal(detail.categoryLabel, index === 0 ? "Package" : "Standalone Ships");
    assert.equal(detail.ships.length, shown.ships.length);
  }
  assert.deepEqual(buildBuybackDetail(rsi.state.buybacks[5]).ships, [], "the account has a buy-back without a ship card");
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildBuybackDetail, createSyntheticRsi, extractBuybackDetail, page, shownPage } from "./buyback-detail-extractor-and-parser-loaded-with-fixture-pages.mjs";

test("lists elsewhere on the page are not taken for the pledge's contents", async () => {
  const rsi = createSyntheticRsi();
  const shown = buildBuybackDetail(rsi.state.buybacks[0]);
  const { url, document } = await shownPage(rsi, shown.id);
  const detail = extractBuybackDetail(document, { baseUrl: url });
  // The page also lists PC requirements in an unordered list; those are not contents.
  assert.ok(document.querySelectorAll(".requirements li").length > 0);
  assert.deepEqual(detail.alsoContains, shown.alsoContains);
});

test("the price is read from the shown text, and never from an attribute or an assumed currency", () => {
  const priced = (inner, attributes = "") => extractBuybackDetail(page(`<h1>Gear - Example Pack</h1><div class="lcol"><div class="price"><strong class="final-price"${attributes}>${inner}</strong></div></div><a class="js-buy-back" data-sku="77"></a>`));
  // The attribute's unit is unknown, so 4500 is kept as text and the amount comes from what is shown.
  const shown = priced('$45<span class="super">.00 <span class="currency">USD</span></span>', ' data-value="4500" data-currency="USD"');
  assert.deepEqual([shown.price, shown.priceText, shown.priceDataValue], [{ amount: "45.00", currency: "USD" }, "$45.00 USD", "4500"]);
  assert.deepEqual(priced("$1,045.50 USD").price, { amount: "1045.50", currency: "USD" });
  assert.deepEqual(priced("€45.00 EUR").price, { amount: "45.00", currency: "EUR" });
  // Text without a currency takes the element's own currency attribute, and no currency at all gives no price.
  assert.deepEqual(priced("$45.00", ' data-currency="EUR"').price, { amount: "45.00", currency: "EUR" });
  const bare = priced("$45.00");
  assert.deepEqual([bare.price, bare.priceText], [null, "$45.00"]);
  assert.deepEqual([priced("").price, priced("").priceText], [null, null]);
  // A saving that is not a percentage is kept as its text.
  const flat = extractBuybackDetail(page('<h1>Gear - Example Pack</h1><div class="price price--has-promo"><strong class="final-price">$40.00 USD</strong>' +
    '<del class="original-price">$45.00 USD</del><span class="discount">Save<strong>$5.00</strong></span></div>'));
  assert.deepEqual([flat.discountPercent, flat.discountText, flat.originalPrice], [null, "Save $5.00", { amount: "45.00", currency: "USD" }]);
});

test("a page that is not a buy-back page is reported as such, whatever it contains", () => {
  assert.deepEqual(extractBuybackDetail(page('<h1>Pledge Store</h1><div class="price"><strong class="final-price">$45.00 USD</strong></div>', "pledge")), { recognized: false });
  // A buy-back page is known by its page class, its add-to-cart button, or its description block.
  assert.equal(extractBuybackDetail(page("<h1>Gear - Example Pack</h1>")).recognized, true);
  assert.equal(extractBuybackDetail(page('<h1>Gear - Example Pack</h1><a class="js-buy-back"></a>', "pledge")).recognized, true);
  assert.equal(extractBuybackDetail(page('<h1>Gear - Example Pack</h1><h2 class="buy-back-title">Gear - Example Pack</h2>', "pledge")).recognized, true);
  // A title without a category is the name; a name may itself contain the separator.
  assert.deepEqual([extractBuybackDetail(page("<h1>Example Pack</h1>")).categoryLabel, extractBuybackDetail(page("<h1>Example Pack</h1>")).name], [null, "Example Pack"]);
  assert.deepEqual([extractBuybackDetail(page("<h1>Package - Aurora MR Starter Pack - Warbond</h1>")).categoryLabel, extractBuybackDetail(page("<h1>Package - Aurora MR Starter Pack - Warbond</h1>")).name], ["Package", "Aurora MR Starter Pack - Warbond"]);
});

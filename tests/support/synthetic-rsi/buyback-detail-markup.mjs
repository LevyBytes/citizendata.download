import { MEDIA, ORIGIN } from "./page-sizes-and-ship-names.mjs";
import { escapeHtml, splitPrice } from "./text-date-and-money-formats.mjs";

// The element structure of /pledge/buyback/<id> as the extension reads it. The unit of `data-value` on the real page
// is not known; the extension records the attribute and reads the price from the shown text.
export function renderBuybackDetail(detail, tokens) {
  const promotion = detail.originalCents === null ? "" : `<del class="original-price">${splitPrice(detail.originalCents)}</del><span class="discount">Save<strong>${detail.discountPercent}%</strong></span>`;
  const ships = detail.ships.map((ship, index) => `<li class="trans-02s js-select-carousel-item"><img class="trans-02s" src="${MEDIA}/buyback-ship-${detail.sku}-${index}.jpg" alt="">`
    + `<div class="info">ship: <span>${escapeHtml(ship.name)}</span></div><div class="info">Manufacturer: <span>${escapeHtml(ship.manufacturer)}</span></div><div class="info">Focus: <span>${escapeHtml(ship.focus)}</span></div>`
    + `<a href="${ORIGIN}${ship.page}" class="trans-05s">ship page</a></li>`).join("");
  return `<div id="store-header"><div class="content-block4"><div class="content"><div class="top"></div><div class="subtitle"></div><h1>${escapeHtml(detail.title)}</h1>`
    + `<a href="${ORIGIN}/pledge/${detail.type}" class="viewall trans-02s">View all <span>${detail.typeLabel}</span></a><div class="cboth"></div></div><div class="bottom"></div></div></div>`
    + `<div class="wcontent"><div class="lcol"><figure><img src="${MEDIA}/buyback-detail-${detail.sku}.jpg" alt="${escapeHtml(detail.name)}"></figure>`
    + `<div class="price ${detail.originalCents === null ? "" : "price--has-promo"}"><strong class="final-price" data-value="${detail.cents}" data-currency="USD">${splitPrice(detail.cents)}</strong>${promotion}</div>`
    + `<a class="holosmallbtn add-cart js-buy-back" href="${ORIGIN}/pledge" data-sku="${detail.sku}"><span class="holosmallbtn-top abs-overlay trans-02s js-label">Add to cart</span><span class="holosmallbtn-bottom abs-overlay trans-02s"></span></a>`
    + `<p class="buy-back-warning"><span class="warn-icon"></span>You have <strong>${tokens}</strong> opportunity to buy back a pledge with store credits</p>`
    + `<div class="requirements"><a class="title js-show-requirements">Show PC requirements</a><ul><li>Synthetic operating system</li><li>Synthetic graphics card</li></ul></div></div>`
    + `<div class="rcol "><h2 class="buy-back-title">${escapeHtml(detail.title)}</h2><div class="buy-back-description"><p></p>${detail.description.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}<p></p></div>`
    + `<div class="package-listing ship"><h4>ship in this pack:</h4><ul>${ships}<div class="corner corner-top-right"></div></ul></div>`
    + `<div class="package-listing item"><h4>Also Contains</h4><ul>${detail.alsoContains.map((item) => `<li class="trans-02s">${escapeHtml(item)}</li>`).join("")}<div class="clear"></div></ul></div></div><div class="clear"></div></div>`;
}

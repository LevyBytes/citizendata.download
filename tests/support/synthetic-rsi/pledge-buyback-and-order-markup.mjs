import { MEDIA } from "./page-sizes-and-ship-names.mjs";
import { escapeHtml, money } from "./text-date-and-money-formats.mjs";

export function renderPledge(pledge) {
  const items = pledge.items.map((item, index) => `<div class="item${item.customName ? " has-custom-name" : ""}"><div class="image" style="background-image:url('${MEDIA}/item-${pledge.id}-${index}.jpg')"></div><div class="text"><div `
    + `class="title">${escapeHtml(item.title)}</div>`
    + `${item.customName ? `<div class="custom-name"><div class="custom-name-icon"></div><div class="custom-name-text">${escapeHtml(item.customName)}</div></div>` : ""}`
    + `${item.kind ? `<div class="kind">${escapeHtml(item.kind)}</div>` : ""}`
    + `${item.liner ? `<div class="liner">${escapeHtml(item.liner.name)} (<span>${escapeHtml(item.liner.code)}</span>)</div>` : ""}</div></div>`).join("");
  const also = pledge.alsoContains.length ? `<div class="without-images">${pledge.alsoContains.map((title) => `<div class="item"><div class="title">${escapeHtml(title)}</div></div>`).join("")}</div>` : "";
  return `<li><input type="hidden" class="js-pledge-id" value="${pledge.id}"><input type="hidden" class="js-pledge-name" value="${escapeHtml(pledge.title)}"><input type="hidden" class="js-pledge-value" value="${money(pledge.valueCents)}"><input `
    + `type="hidden" class="js-pledge-configuration-value" value="${money(pledge.configurationCents)}">`
    + `<div class="basic-infos"><div class="image" style="background-image:url('${MEDIA}/pledge-${pledge.id}.jpg')"></div><div class="wrapper-col"><div class="title-col"><h3>${escapeHtml(pledge.title)}</h3></div><div class="date-col"><label>`
    + `Created:</label> ${pledge.created}</div><div class="items-col"><label>Contains:</label> ${escapeHtml(pledge.contains)}</div></div><span class="availability">${pledge.availability}</span></div>`
    + `<div class="content-block1"><div class="with-images">${items}</div>${also}</div>`
    + `${pledge.giftable ? '<a class="shadow-button js-gift">Gift</a>' : ""}${pledge.meltable ? '<a class="shadow-button js-reclaim">Exchange</a>' : ""}</li>`;
}

export function renderBuyback(buyback, index) {
  // RSI links an ordinary buy-back to its own page. An upgrade has an empty link and the numbers its upgrade tool needs.
  const action = buyback.upgrade
    ? `<a class="holosmallbtn js-open-ship-upgrades" href="" data-pledgeid="${buyback.id}" data-fromshipid="${buyback.upgrade.fromShipId}" data-toshipid="${buyback.upgrade.toShipId}" data-toskuid="${buyback.upgrade.toSkuId}">Buy Back Pledge</a>`
    : `<a class="holosmallbtn" href="/pledge/buyback/${buyback.id}">Buy Back Pledge</a>`;
  // RSI shows two or four description cells; both layouts appear here.
  const cells = index % 7 === 0
    ? `<dt>Last Modified:</dt><dd>${buyback.date}</dd><dt>Reference:</dt><dd>Synthetic</dd><dt>Contained:</dt><dd>${escapeHtml(buyback.contains)}</dd><dt>Note:</dt><dd>Synthetic</dd>`
    : `<dt>Last Modified:</dt><dd>${buyback.date}</dd><dt>Contained:</dt><dd>${escapeHtml(buyback.contains)}</dd>`;
  return `<article class="pledge"><div class="image"><img src="${MEDIA}/buyback-${buyback.id}.jpg" alt=""></div><div class="information"><h1>${escapeHtml(buyback.title)}${buyback.upgraded ? ' <span class="upgraded">- upgraded</span>' : ""}</h1>`
    + `<dl>${cells}</dl></div><div class="buyback-action">${action}</div></article>`;
}

export function renderOrder(order) {
  return `<li><div class="basic-infos"><div class="col"><span>Order Id:</span> ${order.id}</div><div class="col"><span>Order Placed:</span> ${order.placed}</div><div class="col"><span>Status:</span> Completed</div><div class="col"><span>Payment:</span> `
    + `Paid</div><div class="col"><span>Amount:</span> ${money(order.cents)}</div></div>`
    + `<table class="billing-summary"><tr><td>${escapeHtml(order.item)}</td><td>${money(order.cents)}</td><td>1</td><td>${money(0)}</td><td>${money(order.cents)}</td></tr></table>`
    + `<div class="right-section"><strong>Items:</strong> ${money(order.cents)}<br><strong>Credits used:</strong> ${money(0)}<br></div>`
    + `<div class="payment-wrapper"><table><tr><td>${order.placed}</td><td>Card</td><td>Completed</td><td>${money(order.cents)}</td></tr></table></div></li>`;
}

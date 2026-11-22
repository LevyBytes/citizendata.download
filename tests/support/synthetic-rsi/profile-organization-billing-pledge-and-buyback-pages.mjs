import { MEDIA, ORDERS_PER_PAGE, PLEDGES_PER_PAGE } from "./page-sizes-and-ship-names.mjs";
import { money, pager } from "./text-date-and-money-formats.mjs";
import { buildBuybackDetail } from "./generated-buyback-detail-and-upgrade-price.mjs";
import { html, paged, redirect } from "./answer-shapes-and-paging.mjs";
import { renderOrder, renderPledge } from "./pledge-buyback-and-order-markup.mjs";
import { renderBuybackDetail } from "./buyback-detail-markup.mjs";

export function accountPages({ state, handle, organization }) {
  // RSI links a buy-back as /pledge/buyback/<id> and answers it at /en/pledge/buyback/<id>.
  function buybackPage(id, localized) {
    const buyback = state.buybacks.find((candidate) => candidate.id === id && !candidate.upgrade);
    if (!buyback || state.buybackPagesMissing.has(id)) return { status: 404, contentType: "text/html", body: "Not found" };
    if (state.buybackPagesRedirected.has(id)) return redirect("/pledge");
    if (!localized) return redirect(`/en/pledge/buyback/${id}`);
    const detail = buildBuybackDetail(buyback);
    if (state.buybackPagesWithoutHeading.has(id)) return html(renderBuybackDetail(detail, state.buybackTokens).replace(/<h1>.*?<\/h1>/u, ""), ' id="store" class="pledge sku-detail buy-back"');
    return html(renderBuybackDetail(detail, state.buybackTokens), ` id="store" class="pledge sku-detail buy-back ${detail.type}-type"`);
  }

  function profilePage() {
    return html(`<div id="public-profile" class="public-profile"><div class="profile left-col"><div class="thumb"><img src="${MEDIA}/avatar-self.png" alt=""></div><div class="info"><p class="entry"><strong class="value">Synthetic Citizen</strong></p><p `
      + `class="entry"><span class="label">Handle name</span><strong class="value">${handle}</strong></p><p class="entry"><span class="icon"><img src="${MEDIA}/title-civilian.png" alt=""></span><span class="value">Civilian</span></p></div></div>`
      + `<p class="entry citizen-record"><span class="label">UEE Citizen Record</span><strong class="value">#4242424</strong></p>`
      + `<div class="main-org right-col"><div class="info"><p class="entry"><a href="/orgs/${organization.sid}" class="value">${organization.name}</a></p><p class="entry"><span class="label">Spectrum Identification (SID)</span><strong `
      + `class="value">${organization.sid}</strong></p><p class="entry"><span class="label">Organization rank</span><strong class="value">Captain</strong></p></div></div>`
      + `<div class="left-col"><p class="entry"><span class="label">Enlisted</span><strong class="value">Oct 10, 2012</strong></p><p class="entry"><span class="label">Location</span><strong class="value">Synthetic System</strong></p><p class="entry">`
      + `<span class="label">Fluency</span><strong class="value">English</strong></p></div></div>`);
  }

  function organizationsPage() {
    return html(`<div id="public-profile" class="account-profile"><div class="profile-content orgs-content"><div class="box-content org main"><div class="thumb"><a ` +
      `href="/orgs/${organization.sid}"><img src="${MEDIA}/org-${organization.sid}.png" alt=""></a></div><div class="info"><p class="entry `
      + `orgtitle"><span class="label">Organization</span><a href="/orgs/${organization.sid}" class="value">${organization.name}</a></p><p class="entry"><span class="label">Spectrum Identification (SID)</span><strong `
      + `class="value">${organization.sid}</strong></p><p class="entry"><span class="label">Organization rank</span><strong class="value">Captain</strong></p><p class="entry"><span class="label">Archetype</span><strong class="value">Organization</strong>`
      + `</p></div><div class="members">${state.members.length} members</div></div></div></div>`);
  }

  function billingPage(page) {
    const slice = paged(state.orders, page, ORDERS_PER_PAGE);
    const spent = state.orders.reduce((total, order) => total + order.cents, 0);
    return html(`<div class="credits"><div class="credit-line"><span>Store credit</span><em>$25.00 USD</em></div><div class="credit-line uec"><span>UEC</span><em>42,000 UEC</em></div><div class="credit-line rec"><span>REC</span><em>7,500 REC</em></div>`
      + `</div>`
      + `<div class="spent-line">Total spent <em>${money(spent)}</em></div>`
      + `<div class="subscriptions-wrapper" data-subscription-id="SYNSUB1"><div class="badge"><h3>Centurion</h3></div><p><strong>Subscription ID:</strong> SYNSUB1</p><p><strong>Start date:</strong> Jan 1 2020</p><p><strong>Amount:</strong> $10.00 USD</p>`
      + `<table><tr><td>Jan 1 2020</td><td>Card</td><td>Completed</td><td>$10.00 USD</td></tr></table></div>`
      + `<ul class="orders-item">${slice.rows.map(renderOrder).join("")}</ul>${pager(page, slice.pageCount, "&pagesize=100")}`);
  }

  function pledgesPage(page) {
    const slice = paged(state.pledges, page, PLEDGES_PER_PAGE);
    return html(`<ul class="list-items">${slice.rows.map(renderPledge).join("")}</ul>${pager(page, slice.pageCount, "&product-type=")}`);
  }

  return { buybackPage, profilePage, organizationsPage, billingPage, pledgesPage };
}

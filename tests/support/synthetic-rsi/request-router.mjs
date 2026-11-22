import { BUYBACKS_PER_PAGE, LOG_ROWS_PER_PAGE, MEDIA } from "./page-sizes-and-ship-names.mjs";
import { escapeHtml } from "./text-date-and-money-formats.mjs";
import { EMPTY_LEDGER_ANSWER, fragment, html, json } from "./answer-shapes-and-paging.mjs";
import { renderBuyback } from "./pledge-buyback-and-order-markup.mjs";
import { graphqlAndMemberAnswers } from "./graphql-and-organization-member-answers.mjs";
import { accountPages } from "./profile-organization-billing-pledge-and-buyback-pages.mjs";
import { storeUpgradeAnswer } from "./store-upgrade-answers.mjs";

// Gives the function that answers one request to the invented account by its address and method.
export function requestRouter(account) {
  const { state, handle, hangarLogRowsPerPage } = account;
  const { buybackPage, profilePage, organizationsPage, billingPage, pledgesPage } = accountPages(account);
  const { graphql, members } = graphqlAndMemberAnswers(account);

  function route(url, method, body) {
    const path = url.pathname;
    const page = Number(url.searchParams.get("page") ?? body?.page ?? 1);
    if (!state.signedIn && method === "GET") return html('<h1>Restricted Area</h1><p>Authorized Personnel Only</p><p>You must be authenticated to reach this area.</p>');
    if (method === "GET" && path === `/en/citizens/${handle}`) return profilePage();
    if (method === "GET" && path === `/en/citizens/${handle}/organizations`) return organizationsPage();
    if (method === "GET" && path === "/account/pledges") return pledgesPage(page);
    if (method === "GET" && path === "/account/billing") return billingPage(page);
    const buybackPath = /^\/(en\/)?pledge\/buyback\/([0-9]+)$/u.exec(path);
    if (method === "GET" && buybackPath) return buybackPage(Number(buybackPath[2]), Boolean(buybackPath[1]));
    if (method === "GET" && path === "/pledge") return html("<h1>Pledge Store</h1>", ' id="store" class="pledge"');
    if (method !== "POST") return { status: 404, contentType: "text/html", body: "Not found" };
    if (path === "/api/spectrum/auth/identify") return json({ success: 1, data: { member: { id: 4242424, nickname: handle, displayname: "Synthetic Citizen", avatar: `${MEDIA}/avatar-self.png` } } });
    if (path === "/graphql") return graphql(body);
    if (path === "/api/account/pledgeLog") return fragment(
      state.hangarLog, page, hangarLogRowsPerPage,
      (row) => `<div class="pledge-log-entry"><p>${row.when} - <span class="important">${escapeHtml(row.name)}</span> #${row.id} - ${escapeHtml(row.detail)}</p></div>`
    );
    if (path === "/api/account/buybackPledges") return fragment(state.buybacks, page, BUYBACKS_PER_PAGE, renderBuyback);
    const ledger = { "/api/account/creditLog": "storeCredit", "/api/account/uecLog": "uec", "/api/account/recLog": "rec" }[path];
    if (ledger && state.ledgers[ledger].length === 0 && page === 1) return json(structuredClone(EMPTY_LEDGER_ANSWER));
    if (ledger) return fragment(
      state.ledgers[ledger], page, LOG_ROWS_PER_PAGE,
      (row) => `<div class="pledge-log-entry"><p>${row.when} <span class="important">${row.amount < 0 ? `<del>${Math.abs(row.amount).toFixed(2)}</del>` : `<ins>${row.amount.toFixed(2)}</ins>`}</span> - ${escapeHtml(row.detail)}</p></div>`
    );
    if (path === "/api/orgs/getOrgMembers") return members(body);
    const upgradeAnswer = storeUpgradeAnswer(state, path, body);
    if (upgradeAnswer) return upgradeAnswer;
    return json({ success: 0 }, 404);
  }

  return route;
}

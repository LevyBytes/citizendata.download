"use strict";

const PARSERS = Object.freeze({
  profile(document, context) {
    return { raw: globalThis.CitizenDataDomExtractors.extractProfile(document, { baseUrl: context.baseUrl }) };
  },
  pledges(document, context) {
    return {
      raw: globalThis.CitizenDataDomExtractors.extractPledges(document, { baseUrl: context.baseUrl, page: context.page }),
      pageCount: globalThis.CitizenDataBillingExtractors.pageCount(document, context.page)
    };
  },
  buybacks(document, context) {
    return { raw: globalThis.CitizenDataDomExtractors.extractBuybacks(document, { baseUrl: context.baseUrl }) };
  },
  buybackDetail(document, context) {
    return { raw: globalThis.CitizenDataDomExtractors.extractBuybackDetail(document, { baseUrl: context.baseUrl }) };
  },
  hangarLog(document, context) {
    return { raw: globalThis.CitizenDataDomExtractors.extractHangarLog(document, { baseUrl: context.baseUrl }) };
  },
  ledger(document, context) {
    return { raw: globalThis.CitizenDataBillingExtractors.extractLedgerRows(document, context.baseUrl) };
  },
  "financial.balances"(document) {
    return { raw: globalThis.CitizenDataBillingExtractors.extractBalances(document) };
  },
  "financial.billingTotal"(document) {
    return { raw: globalThis.CitizenDataBillingExtractors.extractBillingTotal(document) };
  },
  "financial.orders"(document, context) {
    return {
      raw: globalThis.CitizenDataBillingExtractors.extractOrders(document, context.baseUrl),
      pageCount: globalThis.CitizenDataBillingExtractors.pageCount(document, context.page)
    };
  },
  "financial.subscriptions"(document, context) {
    return { raw: globalThis.CitizenDataBillingExtractors.extractSubscriptions(document, context.baseUrl) };
  },
  "organizations.memberships"(document, context) {
    return { raw: globalThis.CitizenDataDomExtractors.extractOrganizationMemberships(document, { baseUrl: context.baseUrl }) };
  },
  "organizations.members"(document, context) {
    return {
      raw: globalThis.CitizenDataDomExtractors.extractOrganizationMembers(document, {
        organizationSid: context.organizationSid,
        baseUrl: context.baseUrl
      })
    };
  }
});

function inertDocument(fragmentType, html) {
  if (typeof html !== "string") throw new TypeError("RSI markup must be text.");
  const wrapped = fragmentType === "hangarLog"
    ? `<main id="pledge-log">${html}</main>`
    : fragmentType === "ledger"
      ? `<main class="credit-log-rows">${html}</main>`
      : fragmentType === "buybacks"
        ? `<main class="available-pledges">${html}</main>`
        : fragmentType === "organizations.members"
          ? `<main id="members-data">${html}</main>`
          : html;
  const document = new DOMParser().parseFromString(wrapped, "text/html");
  if (document.querySelector("parsererror")) throw new Error("RSI_MARKUP_INVALID");
  return document;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.kind !== "CITIZENDATA_PARSE_RSI_MARKUP") return false;
  try {
    const parser = PARSERS[message.fragmentType];
    if (typeof parser !== "function") throw new Error("RSI_FRAGMENT_TYPE_NOT_ALLOWED");
    const context = message.context && typeof message.context === "object" ? message.context : {};
    const document = inertDocument(message.fragmentType, message.html);
    const parsed = parser(document, context);
    // Page identity (PARSER_HARDENING.md §5.3): whether the page's marker is present, and its first title's text.
    const title = document.querySelector("title");
    sendResponse({ ok: true, ...parsed, pageRecognized: globalThis.CitizenDataDomExtractors.pageRecognized(document, message.fragmentType), pageTitle: title ? title.textContent.trim() : null });
  } catch (error) {
    sendResponse({ ok: false, message: String(error?.message ?? error) });
  }
  return true;
});

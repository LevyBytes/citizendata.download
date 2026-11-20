(function initializeCitizenDataAdapterCatalog(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataAdapterCatalog = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataAdapterCatalog() {
  "use strict";

  const ORGANIZATION_SID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/u;

  const adapters = Object.freeze([
    { id: "profile", version: "0.42.1", route: "/en/citizens/{handle} + /graphql", transport: "background", extractor: "extractProfile", parser: "parseProfile" },
    { id: "pledges", version: "0.42.1", route: "/account/pledges", transport: "background", extractor: "extractPledges", parser: "parsePledges" },
    { id: "hangarLog", version: "0.42.1", route: "/api/account/pledgeLog", transport: "background", extractor: "extractHangarLog", parser: "parseHangarLog" },
    { id: "buybacks", version: "0.42.1", route: "/api/account/buybackPledges", transport: "background", extractor: "extractBuybacks", parser: "parseBuybacks" },
    // Read last and one page per buy-back. `inputs` names the sections whose results it reads, `carriesForward` keeps
    // details captured by earlier backups, and `recordsPerStep` bounds its steps by its record cap.
    { id: "buybackDetails", version: "0.42.1", route: "/pledge/buyback/{id}", transport: "background", extractor: "extractBuybackDetail", parser: "parseBuybackDetails", inputs: Object.freeze(["buybacks"]), carriesForward: true, recordsPerStep: 2 },
    // The price RSI asks now for each different CCU buy-back, read from the store upgrade page's own calls. These
    // prices change, so nothing is carried forward: every build reads them again, one upgrade a step.
    { id: "buybackUpgradePrices", version: "0.42.1", route: "/pledge-store/api/upgrade/graphql", transport: "background", extractor: null, parser: "parseBuybackUpgradePrices", inputs: Object.freeze(["buybacks", "pledges"]), recordsPerStep: 1 },
    { id: "financial.balances", version: "0.42.1", route: "/account/billing", transport: "background", extractor: null, parser: "parseBalances" },
    { id: "financial.billingTotal", version: "0.42.1", route: "/account/billing", transport: "background", extractor: null, parser: "parseBillingTotal" },
    { id: "financial.ledgers", version: "0.42.1", route: "/api/account/*Log", transport: "background", extractor: null, parser: "parseCreditLedger" },
    { id: "financial.orders", version: "0.42.1", route: "/account/billing", transport: "background", extractor: null, parser: "parseOrders" },
    { id: "financial.subscriptions", version: "0.42.1", route: "/account/billing", transport: "background", extractor: null, parser: "parseSubscriptions" },
    { id: "referrals.current.prospects", version: "0.42.1", route: "/graphql", transport: "background", extractor: "extractReferralRows", parser: "parseReferrals", parserOptions: { ladder: "current", kind: "prospects", sharedProspects: true } },
    { id: "referrals.current.recruits", version: "0.42.1", route: "/graphql", transport: "background", extractor: "extractReferralRows", parser: "parseReferrals", parserOptions: { ladder: "current", kind: "recruits" } },
    { id: "referrals.legacy.recruits", version: "0.42.1", route: "/graphql", transport: "background", extractor: "extractReferralRows", parser: "parseReferrals", parserOptions: { ladder: "legacy", kind: "recruits" } },
    { id: "organizations.memberships", version: "0.42.1", route: "/en/citizens/{handle}/organizations", transport: "background", extractor: "extractOrganizationMemberships", parser: "parseOrganizationMemberships" }
  ].map(adapter => Object.freeze({ ...adapter, section: adapter.id })));

  function organizationRosterAdapter(id) {
    if (typeof id !== "string" || !id.startsWith("organizations.members.")) return null;
    const sid = id.slice("organizations.members.".length);
    if (!ORGANIZATION_SID_PATTERN.test(sid)) return null;
    return Object.freeze({
      id,
      section: id,
      version: "0.42.1",
      route: "/api/orgs/getOrgMembers",
      transport: "background",
      extractor: "extractOrganizationMembers",
      parser: "parseOrganizationMembers",
      parserOptions: Object.freeze({ organizationSid: sid }),
      separateAuthorization: true,
      minimumInterRequestDelayMs: 10000,
      maximumRecords: 50000
    });
  }

  function get(id) {
    return adapters.find(adapter => adapter.id === id) ?? organizationRosterAdapter(id);
  }

  return Object.freeze({ ORGANIZATION_SID_PATTERN, adapters, get, organizationRosterAdapter });
});

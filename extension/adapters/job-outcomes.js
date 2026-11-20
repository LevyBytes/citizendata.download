(function initializeCitizenDataJobOutcomes(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataJobOutcomes = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataJobOutcomes() {
  "use strict";

  const JOB_TO_OUTCOMES = Object.freeze({
    profile: Object.freeze(["profile"]),
    pledges: Object.freeze(["pledges"]),
    hangarLog: Object.freeze(["hangarLog"]),
    buybacks: Object.freeze(["buybacks"]),
    buybackDetails: Object.freeze(["buybackDetails"]),
    buybackUpgradePrices: Object.freeze(["buybackUpgradePrices"]),
    "financial.balances": Object.freeze(["financial.balances"]),
    "financial.billingTotal": Object.freeze(["financial.billingTotal"]),
    "financial.ledgers": Object.freeze(["financial.creditLedgers.storeCredit", "financial.creditLedgers.uec", "financial.creditLedgers.rec"]),
    "financial.orders": Object.freeze(["financial.orders"]),
    "financial.subscriptions": Object.freeze(["financial.subscriptions"]),
    "referrals.current.prospects": Object.freeze(["referrals.current.prospects", "referrals.legacy.prospects"]),
    "referrals.current.recruits": Object.freeze(["referrals.current.recruits"]),
    "referrals.legacy.recruits": Object.freeze(["referrals.legacy.recruits"]),
    "organizations.memberships": Object.freeze(["organizations.memberships"])
  });

  function outcomesForJob(section) {
    const value = JOB_TO_OUTCOMES[section];
    if (value) return value;
    const sid = rosterOutcomeKeyFromSection(section);
    if (sid) return Object.freeze([section]);
    throw new TypeError(`No outcome mapping exists for ${section}.`);
  }

  function rosterOutcomeKeyFromSection(section) {
    if (typeof section !== "string" || !section.startsWith("organizations.members.")) return null;
    const sid = section.slice("organizations.members.".length);
    return /^[A-Z0-9][A-Z0-9_-]{0,63}$/u.test(sid) ? sid : null;
  }

  function rosterOutcomeKey(organizationSid) {
    if (typeof organizationSid !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,63}$/u.test(organizationSid)) throw new TypeError("A validated organization SID is required.");
    return organizationSid;
  }

  return Object.freeze({ JOB_TO_OUTCOMES, outcomesForJob, rosterOutcomeKey, rosterOutcomeKeyFromSection });
});

(function exposeSubscriptionSummary(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataSubscriptions = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  const SCALE = 10000n;
  const SUCCESSFUL_PAYMENTS = new Set(["paid", "completed", "successful", "succeeded"]);
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  function readMoney(value) {
    if (!isObject(value) || typeof value.amount !== "string" || typeof value.currency !== "string" || !/^[A-Z]{3}$/u.test(value.currency)) return null;
    const match = /^(-?)([0-9]+)(?:\.([0-9]{1,4}))?$/u.exec(value.amount);
    if (!match) return null;
    const magnitude = BigInt(match[2]) * SCALE + BigInt((match[3] ?? "").padEnd(4, "0"));
    return { currency: value.currency, units: match[1] ? -magnitude : magnitude };
  }

  function decimalString(units) {
    const negative = units < 0n;
    const magnitude = negative ? -units : units;
    const fraction = String(magnitude % SCALE).padStart(4, "0").replace(/0+$/u, "");
    return `${negative ? "-" : ""}${magnitude / SCALE}${fraction ? `.${fraction}` : ""}`;
  }

  function activeTier(subscriptions) {
    const tiers = new Set();
    let unavailable = false;
    for (const subscription of subscriptions) {
      if (!isObject(subscription) || !["active", "ended"].includes(subscription.state)) {
        unavailable = true;
        continue;
      }
      if (subscription.state !== "active") continue;
      const matches = typeof subscription.plan === "string" ? subscription.plan.toLowerCase().match(/\b(?:centurion|imperator)\b/gu) : null;
      const namedTiers = new Set(matches ?? []);
      if (namedTiers.size !== 1) unavailable = true;
      else tiers.add([...namedTiers][0]);
    }
    unavailable ||= tiers.size > 1;
    return { tier: unavailable ? null : [...tiers][0] ?? null, unavailable };
  }

  function summarize(document) {
    const subscriptions = document?.financial?.subscriptions;
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      return { tier: null, totals: [], hasData: false, complete: false, note: "" };
    }

    const status = activeTier(subscriptions);
    const base = { tier: status.tier, totals: [], hasData: true, complete: false, note: "" };
    const seen = new Set();
    for (const subscription of subscriptions) {
      if (!isObject(subscription) || typeof subscription.subscriptionId !== "string" || !subscription.subscriptionId.trim()) {
        return { ...base, note: "Subscription data unavailable" };
      }
      const id = subscription.subscriptionId.trim();
      if (seen.has(id)) return { ...base, note: "Duplicate subscription records" };
      seen.add(id);
    }

    const amounts = new Map();
    let complete = document?.sync?.sectionOutcomes?.["financial.subscriptions"]?.status === "complete";
    function add(value) {
      amounts.set(value.currency, (amounts.get(value.currency) ?? 0n) + value.units);
    }
    for (const subscription of subscriptions) {
      const total = readMoney(subscription.totalPaid);
      if (total) {
        // Billing's cumulative figure already includes this subscription's payments.
        add(total);
        continue;
      }

      // A malformed reported total cannot be replaced with a different interpretation.
      if (subscription.totalPaid !== undefined && subscription.totalPaid !== null) {
        complete = false;
        continue;
      }
      // RSI states no total for this subscription, as for one still running. The payments it lists are counted, and
      // the summary is as complete as the section it was read from.
      if (!Array.isArray(subscription.payments)) continue;
      for (const payment of subscription.payments) {
        if (!isObject(payment) || typeof payment.status !== "string" || !SUCCESSFUL_PAYMENTS.has(payment.status.trim().toLowerCase())) continue;
        const amount = readMoney(payment.amount);
        if (amount) add(amount);
      }
    }

    const totals = [...amounts.keys()].sort().map(currency => ({ currency, amount: decimalString(amounts.get(currency)) }));
    complete &&= totals.length > 0 && !status.unavailable;
    return {
      tier: status.tier,
      totals,
      hasData: true,
      complete,
      note: status.unavailable ? "Subscription status unavailable" : complete ? "" : "Partial history"
    };
  }

  return Object.freeze({ summarize });
});

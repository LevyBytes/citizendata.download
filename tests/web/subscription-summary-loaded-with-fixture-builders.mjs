await import("../../docs/scripts/subscription-summary.js");
export const { summarize } = globalThis.CitizenDataSubscriptions;

export const money = (amount, currency = "USD") => ({ amount, currency });
export function subscription(overrides = {}) {
  return { subscriptionId: "sub-1", plan: "Centurion", state: "active", totalPaid: money("10.00"), payments: [], ...overrides };
}
export function documentWith(subscriptions, outcome = "complete") {
  return { financial: { subscriptions }, sync: { sectionOutcomes: outcome ? { "financial.subscriptions": { status: outcome } } : {} } };
}

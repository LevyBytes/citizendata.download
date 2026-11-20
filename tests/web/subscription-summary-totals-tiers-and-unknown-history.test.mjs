import assert from "node:assert/strict";
import test from "node:test";
import { documentWith, money, subscription, summarize } from "./subscription-summary-loaded-with-fixture-builders.mjs";

test("missing and empty subscription data remain unknown rather than invented zero", () => {
  const expected = { tier: null, totals: [], hasData: false, complete: false, note: "" };
  for (const document of [null, {}, { financial: {} }, documentWith(undefined), documentWith(null), documentWith({}), documentWith([])]) assert.deepEqual(summarize(document), expected);
});

test("cumulative totalPaid wins over payments, rates, order totals, and duration", () => {
  const document = documentWith([subscription({
    totalPaid: money("30.0000"), amount: money("10.00"), totalTimeRaw: "12 years", payments: [{ status: "Paid", amount: money("10.00") }, { status: "Completed", amount: money("20.00") }]
  })]);
  document.financial.orders = [{ total: money("99999.00") }];
  document.financial.billingTotal = money("100000.00");
  assert.deepEqual(summarize(document), { tier: "centurion", totals: [{ currency: "USD", amount: "30" }], hasData: true, complete: true, note: "" });
});

test("active and ended plans both contribute spending but only active plans determine tier", () => {
  const document = documentWith([
    subscription({ plan: "Imperator Prime - Monthly", totalPaid: money("20") }),
    subscription({ subscriptionId: "sub-2", plan: "Centurion", state: "ended", totalPaid: money("10") })
  ]);
  assert.equal(summarize(document).tier, "imperator");
  assert.deepEqual(summarize(document).totals, [{ currency: "USD", amount: "30" }]);
  document.financial.subscriptions[0].state = "ended";
  assert.equal(summarize(document).tier, null);
  assert.deepEqual(summarize(document).totals, [{ currency: "USD", amount: "30" }]);
});

test("dates and renewal settings never manufacture an active subscription", () => {
  const ended = subscription({ state: "ended", recurringState: "active", endDateRaw: "January 1, 2999" });
  assert.equal(summarize(documentWith([ended])).tier, null);
  const active = subscription({ recurringState: "cancelled", endDateRaw: "January 1, 2001" });
  assert.equal(summarize(documentWith([active])).tier, "centurion");
});

test("same-tier active subscriptions agree while conflicting or unknown tiers stay blank", () => {
  const first = subscription({ plan: "CENTURION Subscription" });
  const second = subscription({ subscriptionId: "sub-2", plan: "Centurion Annual Pass" });
  assert.equal(summarize(documentWith([first, second])).tier, "centurion");
  for (const plan of ["Imperator", "Centurion / Imperator", "Unidentified plan", "Imperatorial", null]) {
    const result = summarize(documentWith([first, { ...second, plan }]));
    assert.equal(result.tier, null, plan);
    assert.equal(result.note, "Subscription status unavailable");
    assert.equal(result.complete, false);
    assert.deepEqual(result.totals, [{ currency: "USD", amount: "20" }]);
  }
});

test("fallback counts only explicit successful payments, and a complete section is not called partial", () => {
  const payments = ["paid", " Completed ", "SUCCESSFUL", "succeeded", "pending", "failed", "cancelled", "unpaid", "refunded", "unknown", "payment completed", "success"].map(status => ({ status, amount: money("2.5000") }));
  payments.push({ amount: money("100") }, { status: "paid", amount: null }, null);
  const result = summarize(documentWith([subscription({ totalPaid: null, payments })]));
  assert.deepEqual(result.totals, [{ currency: "USD", amount: "10" }]);
  assert.equal(result.complete, true);
  assert.equal(result.note, "");
  // The same subscriptions read from a section that did not finish are partial.
  const unfinished = summarize(documentWith([subscription({ totalPaid: null, payments })], "partial"));
  assert.deepEqual([unfinished.totals, unfinished.complete, unfinished.note], [[{ currency: "USD", amount: "10" }], false, "Partial history"]);
});

test("a running subscription RSI states no total for does not make a complete build partial", () => {
  const result = summarize(documentWith([
    subscription({ plan: "Imperator Subscription", totalPaid: null, payments: [] }),
    subscription({ subscriptionId: "sub-2", state: "ended", totalPaid: money("1530") })
  ]));
  assert.deepEqual([result.tier, result.totals, result.complete, result.note], ["imperator", [{ currency: "USD", amount: "1530" }], true, ""]);
});

test("empty, failed, pending, and entirely unknown histories do not imply zero spending", () => {
  for (const payments of [undefined, null, {}, [], [{ status: "pending", amount: money("20") }], [{ status: "failed", amount: money("20") }], [{ status: "unrecognized", amount: money("20") }]]) {
    const result = summarize(documentWith([subscription({ totalPaid: null, amount: money("20"), payments })]));
    assert.equal(result.hasData, true);
    assert.deepEqual(result.totals, []);
    assert.equal(result.complete, false);
  }
});

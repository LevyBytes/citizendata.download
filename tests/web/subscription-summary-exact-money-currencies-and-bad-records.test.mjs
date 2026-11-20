import assert from "node:assert/strict";
import test from "node:test";
import { documentWith, money, subscription, summarize } from "./subscription-summary-loaded-with-fixture-builders.mjs";

test("an explicitly reported zero is retained and overrides payment history", () => {
  const result = summarize(documentWith([subscription({ totalPaid: money("0.0000"), payments: [{ status: "paid", amount: money("50") }] })]));
  assert.deepEqual(result.totals, [{ currency: "USD", amount: "0" }]);
  assert.equal(result.complete, true);
});

test("totals preserve exact decimals beyond Number precision and all four fraction digits", () => {
  const result = summarize(documentWith([
    subscription({ totalPaid: money("9007199254740993.0001") }),
    subscription({ subscriptionId: "sub-2", state: "ended", totalPaid: money("0.9999") }),
    subscription({ subscriptionId: "sub-3", state: "ended", totalPaid: money("-0.0001") })
  ]));
  assert.deepEqual(result.totals, [{ currency: "USD", amount: "9007199254740993.9999" }]);
  const zero = summarize(documentWith([
    subscription({ totalPaid: money("0.10") }),
    subscription({ subscriptionId: "sub-2", totalPaid: money("-0.1000") })
  ]));
  assert.deepEqual(zero.totals, [{ currency: "USD", amount: "0" }]);
});

test("mixed currencies stay separate with deterministic currency ordering", () => {
  const result = summarize(documentWith([
    subscription({ totalPaid: money("20", "USD") }),
    subscription({ subscriptionId: "sub-2", totalPaid: money("3.1250", "EUR") }),
    subscription({ subscriptionId: "sub-3", state: "ended", totalPaid: money("4.0001", "EUR") }),
    subscription({ subscriptionId: "sub-4", state: "ended", totalPaid: money("-1.50", "GBP") })
  ]));
  assert.deepEqual(result.totals, [{ currency: "EUR", amount: "7.1251" }, { currency: "GBP", amount: "-1.5" }, { currency: "USD", amount: "20" }]);
  assert.equal(result.complete, true);
});

test("duplicate subscription IDs suppress totals instead of double-counting snapshots", () => {
  for (const duplicate of [subscription(), subscription({ subscriptionId: " sub-1 ", state: "ended", totalPaid: money("999") })]) {
    const result = summarize(documentWith([subscription(), duplicate]));
    assert.deepEqual(result.totals, []);
    assert.equal(result.complete, false);
    assert.equal(result.note, "Duplicate subscription records");
  }
});

test("missing IDs and malformed subscription records cannot produce an aggregate", () => {
  for (const bad of [null, [], 7, subscription({ subscriptionId: "" }), subscription({ subscriptionId: null }), subscription({ subscriptionId: 3 })]) {
    const result = summarize(documentWith([subscription(), bad]));
    assert.deepEqual(result.totals, []);
    assert.equal(result.complete, false);
    assert.equal(result.note, "Subscription data unavailable");
  }
});

test("invalid reported money is not coerced or replaced with payment history", () => {
  for (const totalPaid of [money(10), money("1e2"), money("NaN"), money("0.00001"), money("10", "usd"), {}, [], "10.00"]) {
    const result = summarize(documentWith([subscription({ totalPaid, payments: [{ status: "paid", amount: money("50") }] })]));
    assert.deepEqual(result.totals, []);
    assert.equal(result.complete, false);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { documentWith, money, subscription, summarize } from "./subscription-summary-loaded-with-fixture-builders.mjs";

test("source coverage controls completeness even when every cumulative total is present", () => {
  for (const outcome of [undefined, null, "failed", "skipped", "notRun", "partial"]) {
    const document = documentWith([subscription()], outcome === undefined ? null : outcome);
    const result = summarize(document);
    assert.deepEqual(result.totals, [{ currency: "USD", amount: "10" }]);
    assert.equal(result.complete, false);
    assert.equal(result.note, "Partial history");
  }
});

test("subscriptions RSI states no total for are counted by the payments it lists", () => {
  const result = summarize(documentWith([
    subscription({ totalPaid: money("30") }),
    subscription({ subscriptionId: "sub-2", state: "ended", totalPaid: null, payments: [{ status: "paid", amount: money("5") }] }),
    subscription({ subscriptionId: "sub-3", state: "ended", totalPaid: null, payments: [] })
  ]));
  assert.deepEqual(result.totals, [{ currency: "USD", amount: "35" }]);
  assert.equal(result.note, "");
  assert.equal(result.complete, true);
});

test("summary leaves the loaded document unchanged and exposes no BigInt values", () => {
  function freeze(value) {
    if (value && typeof value === "object") {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  }
  const document = freeze(documentWith([subscription({ totalPaid: null, payments: [{ status: "paid", amount: money("0.1250") }] })]));
  const before = JSON.stringify(document);
  const result = summarize(document);
  assert.equal(JSON.stringify(document), before);
  assert.doesNotThrow(() => JSON.stringify(result));
  result.totals[0].amount = "999";
  assert.equal(document.financial.subscriptions[0].payments[0].amount.amount, "0.1250");
});

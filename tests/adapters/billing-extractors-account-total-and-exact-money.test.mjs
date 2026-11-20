import assert from "node:assert/strict";
import test from "node:test";
import { Extractors } from "./billing-extractors-loaded-with-fixture-nodes.mjs";

test("billing extractors preserve the observed account total as exact Billing page evidence", () => {
  const observedTotal = ["$49", "022.91 USD"].join(",");
  const subscriptionTime = {
    textContent: "Centurion: 12 Months - Imperator: 86 Months",
    querySelector(selector) { return selector === "em" ? { textContent: "Centurion: 12 Months - Imperator: 86 Months" } : null; }
  };
  const totalSpent = {
    textContent: `${observedTotal} TOTAL SPENT`,
    querySelector(selector) { return selector === "em" ? { textContent: observedTotal } : null; }
  };
  const document = {
    querySelectorAll(selector) { return selector === ".spent-line" ? [subscriptionTime, totalSpent] : []; }
  };
  assert.deepEqual(Extractors.extractBillingTotal(document), { amount: "49022.91", currency: "USD" });
});

test("billing money parsing never converts exact decimal strings through floating point", () => {
  const document = {
    querySelectorAll(selector) {
      return selector === ".spent-line" ? [{
        textContent: "$90,071,992,547,409,931,234.6789 USD TOTAL SPENT",
        querySelector(innerSelector) { return innerSelector === "em" ? { textContent: "$90,071,992,547,409,931,234.6789 USD" } : null; }
      }] : [];
    }
  };
  assert.deepEqual(Extractors.extractBillingTotal(document), { amount: "90071992547409931234.6789", currency: "USD" });
});

test("ambiguous generic currency values are not silently relabeled as USD", () => {
  const document = {
    querySelectorAll(selector) {
      return selector === ".spent-line" ? [{
        textContent: "¤ 12.00 TOTAL SPENT",
        querySelector(innerSelector) { return innerSelector === "em" ? { textContent: "¤ 12.00" } : null; }
      }] : [];
    }
  };
  assert.equal(Extractors.extractBillingTotal(document), null);
});

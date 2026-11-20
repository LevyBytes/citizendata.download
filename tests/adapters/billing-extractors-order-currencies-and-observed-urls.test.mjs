import assert from "node:assert/strict";
import test from "node:test";
import { Extractors, anchor, baseUrl, field, strongField } from "./billing-extractors-loaded-with-fixture-nodes.mjs";

test("billing orders keep RSI currencies and isolate each value in a shared totals row", () => {
  const basicFields = [
    field("Order Id", "ORDER-REC-1"),
    field("Amount", "¤ 172900 REC"),
    field("Order Placed", "November 18, 2026"),
    field("Status", "Completed")
  ];
  const basic = {
    querySelectorAll(selector) { return selector === ".col, .s-row, p, dd" ? basicFields : []; }
  };
  const totals = [
    strongField("Items", "¤ 172900 REC"),
    strongField("Additional discount", "¤ 100 REC"),
    strongField("Credits used", "¤ 1200 REC"),
    strongField("Shipping & handling", "$5.00 USD"),
    strongField("Tax", "$1.25 USD")
  ];
  const order = {
    textContent: "Completed order",
    querySelector(selector) { return selector === ".basic-infos" ? basic : null; },
    querySelectorAll(selector) {
      if (selector === "strong") return totals;
      return [];
    }
  };
  const document = {
    querySelectorAll(selector) { return selector === "ul.orders-item > li" ? [order] : []; }
  };
  const [result] = Extractors.extractOrders(document, baseUrl);
  assert.deepEqual(result.total, { amount: "172900", currency: "REC" });
  assert.deepEqual(result.itemsTotal, { amount: "172900", currency: "REC" });
  assert.deepEqual(result.additionalDiscount, { amount: "100", currency: "REC" });
  assert.deepEqual(result.creditsUsed, { amount: "1200", currency: "REC" });
  assert.deepEqual(result.shippingAndHandling, { amount: "5.00", currency: "USD" });
  assert.deepEqual(result.tax, { amount: "1.25", currency: "USD" });
});

test("billing extractors preserve observed subscription, invoice, and tracking URLs", () => {
  const subscriptionLink = anchor("/pledge/subscriptions");
  const subscription = {
    textContent: "Active subscription",
    getAttribute(name) { return name === "data-subscription-id" ? "sub-1" : null; },
    querySelector(selector) { return selector === ".badge h3" ? { textContent: "Imperator" } : null; },
    querySelectorAll(selector) {
      if (selector === "a[href]") return [subscriptionLink];
      return [];
    }
  };
  const subscriptionDocument = {
    querySelectorAll(selector) { return selector.includes("subscriptions-wrapper") ? [subscription] : []; }
  };
  const subscriptions = Extractors.extractSubscriptions(subscriptionDocument, baseUrl);
  assert.deepEqual(subscriptions[0].relatedUrls, [baseUrl, "https://robertsspaceindustries.com/pledge/subscriptions"]);

  const invoice = anchor("/en/account/billing/invoice/ORDER-1");
  const tracking = anchor("https://tracking.example.test/parcel/ORDER-1");
  const basicFields = [field("Order Id", "ORDER-1"), field("Amount", "$10.00"), field("Order Placed", "November 18, 2026"), field("Status", "Completed")];
  const basic = {
    querySelectorAll(selector) { return selector === ".col, .s-row, p, dd" ? basicFields : []; }
  };
  const order = {
    textContent: "Completed order Track shipment",
    querySelector(selector) {
      if (selector === ".basic-infos") return basic;
      if (selector === ".js-print-invoice") return invoice;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "a[href]") return [invoice, tracking];
      return [];
    }
  };
  const orderDocument = {
    querySelectorAll(selector) { return selector === "ul.orders-item > li" ? [order] : []; }
  };
  const orders = Extractors.extractOrders(orderDocument, baseUrl);
  assert.deepEqual(orders[0].relatedUrls, [baseUrl, "https://robertsspaceindustries.com/en/account/billing/invoice/ORDER-1", "https://tracking.example.test/parcel/ORDER-1"]);
  assert.equal(orders[0].invoiceAvailable, true);
});

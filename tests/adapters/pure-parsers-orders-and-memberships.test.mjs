import assert from "node:assert/strict";
import test from "node:test";
import { Parsers, context, money } from "./pure-parsers-under-test.mjs";

test("orders and memberships preserve physical flags, exact totals, and explicit membership facts", async () => {
  const orders = await Parsers.parseOrders([{
    orderId: "ORDER-1",
    placedAtRaw: "November 17, 2026",
    status: "Completed",
    physical: true,
    items: [{
      name: "Physical item",
      quantity: 1,
      unitPrice: money("10.00"),
      discount: money("0.00"),
      total: money("10.00"),
      physical: true,
      trackingAvailable: false,
      images: [],
      relatedUrls: ["https://robertsspaceindustries.com/en/account/billing/track/ORDER-1"]
    }],
    itemsTotal: money("10.00"),
    additionalDiscount: money("0.00"),
    creditsUsed: money("0.00"),
    shippingAndHandling: null,
    tax: null,
    total: money("10.00"),
    payments: [],
    invoiceAvailable: true,
    relatedUrls: ["https://robertsspaceindustries.com/en/account/billing", "https://robertsspaceindustries.com/en/account/billing/invoice/ORDER-1"]
  }], context);
  assert.equal(orders.value[0].physical, true);
  assert.equal(orders.value[0].total.amount, "10.00");
  assert.equal(orders.value[0].items[0].relatedUrls.length, 1);
  assert.equal(orders.value[0].observation.relatedUrls.length, 2);

  const memberships = await Parsers.parseOrganizationMemberships([{
    sid: "TEST",
    name: "Test Organization",
    membershipType: "main",
    memberCount: 24652,
    rank: "Recruit",
    images: [],
    relatedUrls: ["https://robertsspaceindustries.com/en/orgs/TEST"]
  }], context);
  assert.equal(memberships.value[0].memberCount, 24652);
  assert.equal(memberships.value[0].recruiting, null);
  assert.deepEqual(memberships.value[0].observation.relatedUrls, ["https://robertsspaceindustries.com/en/orgs/TEST"]);
});

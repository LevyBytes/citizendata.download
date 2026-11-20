import assert from "node:assert/strict";
import test from "node:test";

await import("../../extension/adapters/update-delta.js");
const Delta = globalThis.CitizenDataUpdateDelta;

const hangar = (name) => ({ rawTimestamp: "now", subjectId: 1, subjectName: name, kind: "created", rawDetail: name, parsed: {}, observation: { relatedUrls: ["https://robertsspaceindustries.com/account/pledges"] } });
const referral = (key, name) => ({ recordKey: key, displayName: name, handle: name, displayNameRaw: name, nicknameRaw: name, dateLabel: "enlistedOn", dateRaw: "2026-11-18", dateSortKey: "2026-11-18", images: [], observation: { relatedUrls: [] } });

test("Hangar update anchors compare raw rows with canonical rows and preserve raw reconstruction", () => {
  const previous = [hangar("old-1"), hangar("old-2")];
  const current = [hangar("new"), ...previous.map(({ observation, ...row }) => row)];
  assert.equal(Delta.findAnchor(current, previous, Delta.hangarRecord), 1);
  assert.deepEqual(Delta.hangarAsRaw(previous[0]).relatedUrls, previous[0].observation.relatedUrls);
});

test("referral update anchors preserve exact identity and date fields", () => {
  const previous = [referral("old-1", "One"), referral("old-2", "Two")];
  const current = [referral("new", "New"), ...previous.map(Delta.referralAsRaw)];
  assert.equal(Delta.findAnchor(current, previous, Delta.referralRecord), 1);
  assert.equal(Delta.prefixMatches(previous.map(Delta.referralAsRaw), previous, Delta.referralRecord), true);
  current[1].handle = "Changed";
  assert.equal(Delta.findAnchor(current, previous, Delta.referralRecord), -1);
});

test("order comparison includes state, exact money, payments, and contained items", () => {
  const previous = [{
    orderId: "ORDER-1", placedAtRaw: "now", storefront: "RSI", status: "CLOSED", paymentState: "PAID", fulfillmentState: "DONE", physical: false,
    items: [{ name: "Item", unitPrice: { amount: "10.00", currency: "USD" }, quantity: 1, discount: { amount: "0.00", currency: "USD" }, total: { amount: "10.00", currency: "USD" }, physical: false, trackingAvailable: false, images: [], relatedUrls: [] }],
    billingAddress: null, shippingAddress: null, itemsTotal: { amount: "10.00", currency: "USD" }, additionalDiscount: { amount: "0.00", currency: "USD" },
    creditsUsed: { amount: "0.00", currency: "USD" }, shippingAndHandling: null, tax: null, total: { amount: "10.00", currency: "USD" },
    payments: [{ rawTimestamp: "now", processor: "card", status: "PAID", amount: { amount: "10.00", currency: "USD" } }], invoiceAvailable: true, observation: { lastObservedAt: "old" }
  }];
  const current = structuredClone(previous);
  delete current[0].observation;
  assert.equal(Delta.prefixMatches(current, previous, Delta.orderRecord), true);
  current[0].total.amount = "11.00";
  assert.equal(Delta.prefixMatches(current, previous, Delta.orderRecord), false);
});

test("ledger anchors compare exact timestamp, amount, and detail and reconstruct parser input", () => {
  const previous = [{ rawTimestamp: "now", amount: "10.00", rawDetail: "Credit", parsed: { recognized: true }, observation: { relatedUrls: ["https://robertsspaceindustries.com/api/account/creditLog"] } }];
  assert.equal(Delta.findAnchor([{ rawTimestamp: "now", amount: "10.00", rawDetail: "Credit" }], previous, Delta.ledgerRecord), 0);
  assert.deepEqual(Delta.ledgerAsRaw(previous[0]).relatedUrls, previous[0].observation.relatedUrls);
  assert.equal(Delta.findAnchor([{ rawTimestamp: "now", amount: "11.00", rawDetail: "Credit" }], previous, Delta.ledgerRecord), -1);
});

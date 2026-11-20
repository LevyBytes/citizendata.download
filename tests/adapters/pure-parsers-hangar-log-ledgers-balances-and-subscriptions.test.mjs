import assert from "node:assert/strict";
import test from "node:test";
import { Parsers, context, money } from "./pure-parsers-under-test.mjs";

test("Hangar Log and ledger parsers preserve identical duplicate occurrence ordinals", async () => {
  const row = { rawTimestamp: "Nov 17", subjectId: 42, subjectName: "Package", kind: "created", rawDetail: "Created", parsed: { recognized: true } };
  const log = await Parsers.parseHangarLog([row, row], context);
  assert.equal(log.value[0].fingerprint, log.value[1].fingerprint);
  assert.deepEqual(log.value.map(entry => entry.occurrenceOrdinal), [2, 1]);
  const next = await Parsers.parseHangarLog([row, row, row], context);
  assert.deepEqual(next.value.map(entry => entry.occurrenceOrdinal), [3, 2, 1]);
  assert.deepEqual(next.value.slice(1).map(entry => `${entry.fingerprint}:${entry.occurrenceOrdinal}`), log.value.map(entry => `${entry.fingerprint}:${entry.occurrenceOrdinal}`));

  const ledger = await Parsers.parseCreditLedger([
    { rawTimestamp: "Nov 17", amount: "0.00", rawDetail: "No-cost adjustment" },
    { rawTimestamp: "Nov 17", amount: "0.00", rawDetail: "No-cost adjustment" }
  ], context, { ledger: "storeCredit" });
  assert.deepEqual(ledger.value.map(entry => entry.occurrenceOrdinal), [1, 2]);
  assert.equal(ledger.value[0].amount, "0.00");
});

test("financial parsers preserve unknown balances and active subscriptions without an invented end date", async () => {
  const balances = await Parsers.parseBalances({ storeCredit: { amount: "25.00" }, uec: null, rec: null }, context, { complete: false });
  assert.equal(balances.value.uec, null);
  assert.equal(balances.outcome.status, "partial");

  const total = await Parsers.parseBillingTotal(money("692.00"), context);
  assert.equal(total.value.source, "billingPageTotal");

  const subscriptions = await Parsers.parseSubscriptions([{
    subscriptionId: "sub-1",
    plan: "Imperator",
    state: "active",
    startDateRaw: "January 1, 2025",
    endDateRaw: null,
    amount: money("20.00"),
    totalPaid: money("440.00"),
    payments: [],
    images: [],
    relatedUrls: ["https://robertsspaceindustries.com/en/account/billing"]
  }], context);
  assert.equal(subscriptions.value[0].endDateRaw, null);
  assert.equal(subscriptions.value[0].totalPaid.amount, "440.00");
  assert.deepEqual(subscriptions.value[0].observation.relatedUrls, ["https://robertsspaceindustries.com/en/account/billing"]);
});

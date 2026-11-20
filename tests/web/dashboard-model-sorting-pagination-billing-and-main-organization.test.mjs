import assert from "node:assert/strict";
import test from "node:test";
import { Model } from "./dashboard-scripts-under-test.mjs";

test("referral sorting uses normalized dates and keeps missing dates last", () => {
  const records = [
    { recordKey: "b", dateSortKey: "2950-01-01" },
    { recordKey: "missing", dateSortKey: null },
    { recordKey: "a", dateSortKey: "2950-03-01" }
  ];
  assert.deepEqual(Model.sortReferralRecords(records, "newest").map((item) => item.recordKey), ["a", "b", "missing"]);
  assert.deepEqual(Model.sortReferralRecords(records, "oldest").map((item) => item.recordKey), ["b", "a", "missing"]);
});

test("referral sorting uses the exact RSI source timestamp when the calendar key is unavailable", () => {
  const records = [
    { recordKey: "new", dateSortKey: null, dateRaw: "2026-08-02 17:34:42" },
    { recordKey: "old", dateSortKey: null, dateRaw: "2017-05-05 20:09:26" },
    { recordKey: "unknown", dateSortKey: null, dateRaw: "Unavailable" }
  ];
  assert.deepEqual(Model.sortReferralRecords(records, "newest").map((item) => item.recordKey), ["new", "old", "unknown"]);
  assert.deepEqual(Model.sortReferralRecords(records, "oldest").map((item) => item.recordKey), ["old", "new", "unknown"]);
});

test("pagination clamps its page and preserves record totals", () => {
  const result = Model.paginate([1, 2, 3, 4, 5], 9, 2);
  assert.deepEqual(result.items, [5]);
  assert.equal(result.page, 3);
  assert.equal(result.totalPages, 3);
});

test("billing total uses only direct Billing-page evidence", () => {
  const direct = { amount: "125.00", currency: "USD", observedAt: "2026-11-17T00:00:00Z", source: "billingPageTotal" };
  assert.equal(Model.getBillingTotal({ financial: { billingTotal: direct, orders: [{ total: { amount: "999.00", currency: "USD" } }] } }), direct);
  assert.equal(Model.getBillingTotal({ financial: { orders: [{ total: { amount: "999.00", currency: "USD" } }] } }), null);
});

test("missing balances remain unknown while genuine zero balances remain zero", () => {
  assert.equal(Model.getBalance({}, "storeCredit"), null);
  assert.equal(Model.getBalance({ financial: { balances: { storeCredit: null } } }, "storeCredit"), null);
  const zero = { amount: "0.00", unit: "USD" };
  assert.equal(Model.getBalance({ financial: { balances: { storeCredit: zero } } }, "storeCredit"), zero);
  assert.equal(Model.formatExactMoney(Model.getBalance({}, "storeCredit")?.amount, "USD"), "—");
  assert.equal(Model.formatExactMoney(zero.amount, zero.unit), "$0.00");
});

test("main organization requires an explicit main identity rather than array order", () => {
  const affiliate = { sid: "AFF", membershipType: "affiliate" };
  const main = { sid: "MAIN", membershipType: "main" };
  const legacyMain = { sid: "LEGACY", isMain: true };
  const document = { profile: {}, organizations: { memberships: [affiliate, legacyMain, main] } };
  assert.equal(Model.getMainMembership(document), main);
  document.profile.mainOrganizationSid = "LEGACY";
  assert.equal(Model.getMainMembership(document), legacyMain);
  document.profile.mainOrganizationSid = "MISSING";
  assert.equal(Model.getMainMembership(document), null, "An absent explicit main SID must not silently select a different organization.");
  document.profile.mainOrganizationSid = "AFF";
  assert.equal(Model.getMainMembership(document), null, "Contradictory affiliate metadata must not be promoted to main.");
  document.profile.mainOrganizationSid = null;
  document.organizations.memberships = [affiliate];
  assert.equal(Model.getMainMembership(document), null);
  document.organizations.memberships = [{ ...affiliate, isMain: true }];
  assert.equal(Model.getMainMembership(document), null);
  document.organizations.memberships = [{ sid: "LEGACY", isMain: "false" }];
  assert.equal(Model.getMainMembership(document), null);
  document.organizations.memberships = [legacyMain];
  assert.equal(Model.getMainMembership(document), legacyMain);
});

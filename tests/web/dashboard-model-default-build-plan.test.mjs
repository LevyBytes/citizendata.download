import assert from "node:assert/strict";
import test from "node:test";
import { Model, PlanValidation } from "./dashboard-scripts-under-test.mjs";

test("default Build JSON proposal matches the extension-owned plan contract", () => {
  const plan = Model.buildDefaultPlan();
  const result = PlanValidation.validatePlan(plan);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(plan.selectedSections, [
    "profile",
    "financial.balances",
    "financial.billingTotal",
    "financial.ledgers",
    "financial.orders",
    "financial.subscriptions",
    "hangarLog",
    "pledges",
    "buybacks",
    "referrals.legacy.recruits",
    "referrals.current.prospects",
    "referrals.current.recruits",
    "organizations.memberships",
    "buybackDetails",
    "buybackUpgradePrices"
  ]);
  assert.equal(plan.maximumRecordsBySection["organizations.memberships"], 1000);
});

import assert from "node:assert/strict";

await import("../../docs/scripts/account-document.js");
await import("../support/synthetic-rsi.js");
export const { buildBuybackDetail, upgradePriceCents } = globalThis.CitizenDataSyntheticRsi;
// What the synthetic store asks for a CCU buy-back, in cents.
export const upgradeCents = (shown) => upgradePriceCents(Number(shown.upgrade.fromShipId), Number(shown.upgrade.toSkuId));
export const shownMoney = (cents) => ({ amount: (cents / 100).toFixed(2), currency: "USD" });
await import("../../docs/schema/account-export.schema.js");
export const AccountDocument = globalThis.CitizenDataAccountDocument;
export function counts(document) {
  return {
    pledges: document.pledges.length,
    buybacks: document.buybacks.length,
    hangarLog: document.hangarLog.length,
    orders: document.financial.orders.length,
    storeCredit: document.financial.creditLedgers.storeCredit.length,
    uec: document.financial.creditLedgers.uec.length,
    rec: document.financial.creditLedgers.rec.length,
    prospects: document.referrals.current.prospects.length,
    legacyProspects: document.referrals.legacy.prospects.length,
    recruits: document.referrals.current.recruits.length,
    legacyRecruits: document.referrals.legacy.recruits.length,
    memberships: document.organizations.memberships.length
  };
}

function expectedCounts(rsi) {
  return {
    pledges: rsi.state.pledges.length,
    buybacks: rsi.state.buybacks.length,
    hangarLog: rsi.state.hangarLog.length,
    orders: rsi.state.orders.length,
    storeCredit: rsi.state.ledgers.storeCredit.length,
    uec: rsi.state.ledgers.uec.length,
    rec: rsi.state.ledgers.rec.length,
    prospects: rsi.state.referrals.prospects.length,
    legacyProspects: rsi.state.referrals.prospects.length,
    recruits: rsi.state.referrals.recruits.length,
    legacyRecruits: rsi.state.referrals.legacyRecruits.length,
    memberships: 1
  };
}

function unique(values) {
  return new Set(values).size === values.length;
}

export async function assertCompleteDocument(document, rsi) {
  assert.deepEqual(counts(document), expectedCounts(rsi));
  assert.ok(unique(document.pledges.map((record) => record.pledgeId)), "pledges are not repeated");
  assert.ok(unique(document.buybacks.map((record) => record.buybackId)), "buybacks are not repeated");
  assert.ok(unique(document.financial.orders.map((record) => record.orderId)), "orders are not repeated");
  assert.deepEqual(Object.entries(document.sync.sectionOutcomes).filter(([, outcome]) => outcome.status !== "complete").map(([section]) => section), []);
  assert.equal(await AccountDocument.verifyIntegrity(structuredClone(document)), true);
  AccountDocument.assertValid(structuredClone(document), globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
}

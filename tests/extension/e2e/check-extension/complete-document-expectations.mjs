import assert from "node:assert/strict";
import { buildBuybackDetail, upgradePriceCents } from "./browser-pages-and-account-in-use.mjs";

function expectedCounts(account) {
  return {
    pledges: account.state.pledges.length,
    buybacks: account.state.buybacks.length,
    hangarLog: account.state.hangarLog.length,
    orders: account.state.orders.length,
    storeCredit: account.state.ledgers.storeCredit.length,
    uec: account.state.ledgers.uec.length,
    rec: account.state.ledgers.rec.length,
    prospects: account.state.referrals.prospects.length,
    legacyProspects: account.state.referrals.prospects.length,
    recruits: account.state.referrals.recruits.length,
    legacyRecruits: account.state.referrals.legacyRecruits.length,
    memberships: 1,
    // One captured page for each buy-back that has a page of its own; an upgrade has none.
    buybackDetails: account.state.buybacks.filter((buyback) => !buyback.upgrade).length
  };
}

// A record RSI no longer lists is kept in the backup beside the listed ones; the counts here are of listed records.
export const KEPT_STATE = "not-reconcilable";
const listedRecords = (records) => records.filter((record) => record.state !== KEPT_STATE);

export function assertCompleteDocument(document, account) {
  const keptBuybackPages = document.buybacks.filter((record) => record.state === KEPT_STATE && record.kind === "ordinary").length;
  assert.deepEqual({
    pledges: listedRecords(document.pledges).length,
    buybacks: listedRecords(document.buybacks).length,
    hangarLog: document.hangarLog.length,
    orders: document.financial.orders.length,
    storeCredit: document.financial.creditLedgers.storeCredit.length,
    uec: document.financial.creditLedgers.uec.length,
    rec: document.financial.creditLedgers.rec.length,
    prospects: document.referrals.current.prospects.length,
    legacyProspects: document.referrals.legacy.prospects.length,
    recruits: document.referrals.current.recruits.length,
    legacyRecruits: document.referrals.legacy.recruits.length,
    memberships: document.organizations.memberships.length,
    buybackDetails: document.buybackDetails.length - keptBuybackPages
  }, expectedCounts(account), "The saved backup does not hold every synthetic record.");
  // Every buy-back with a page of its own carries the price that page showed, and every CCU buy-back the price the
  // store upgrade page asked.
  const shownCents = new Map(account.state.buybacks.map((buyback) => [buyback.id, buyback.upgrade ? upgradePriceCents(Number(buyback.upgrade.fromShipId), Number(buyback.upgrade.toSkuId)) : buildBuybackDetail(buyback).cents]));
  for (const record of listedRecords(document.buybacks)) {
    assert.deepEqual(record.buybackPrice, shownCents.has(record.buybackId) ? { amount: (shownCents.get(record.buybackId) / 100).toFixed(2), currency: "USD" } : null, `Buy-back ${record.buybackId} does not carry the price RSI showed for it.`);
  }
  // A step repeated after an interruption must not duplicate its records.
  for (const [name, keys] of [["pledges", document.pledges.map((record) => record.pledgeId)], ["buybacks", document.buybacks.map((record) => record.buybackId)], ["orders", document.financial.orders.map((record) => record.orderId)]]) {
    assert.equal(new Set(keys).size, keys.length, `The saved backup repeats ${name} records.`);
  }
  const incomplete = Object.entries(document.sync.sectionOutcomes).filter(([, outcome]) => outcome.status !== "complete").map(([section]) => section);
  assert.deepEqual(incomplete, [], "Every section must be recorded complete.");
  assert.equal(document.account.handle, account.state.handle);
}

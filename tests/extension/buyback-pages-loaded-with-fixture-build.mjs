import assert from "node:assert/strict";

await import("../../docs/scripts/account-document.js");
await import("../../docs/schema/account-export.schema.js");
await import("../support/synthetic-rsi.js");
const AccountDocument = globalThis.CitizenDataAccountDocument;
export const { buildBuybackDetail } = globalThis.CitizenDataSyntheticRsi;

// A small account keeps each run short; one in four buy-backs is an upgrade, and its last three ordinary buy-backs
// are further buy-backs of its first three items.
export const SMALL = { counts: { pledges: 12, buybacks: 24, orders: 5, storeCredit: 5, uec: 3, rec: 2, olderHangarLogRows: 5, prospects: 5, recruits: 2, legacyRecruits: 1, organizationMembers: 5 } };
export const PAGE = /^\/pledge\/buyback\/([0-9]+)$/u;

export const plain = (value) => JSON.parse(JSON.stringify(value));
export const resultOf = (tab) => plain(tab.events.filter((event) => event.result).at(-1)?.result ?? null);
export const pageRequests = (requests) => requests.filter((request) => PAGE.test(request.path));
export const pageIds = (requests) => pageRequests(requests).map((request) => Number(PAGE.exec(request.path)[1]));
export const ordinary = (rsi) => rsi.state.buybacks.filter((buyback) => !buyback.upgrade);
export const shownPrice = (buyback) => ({ amount: (buildBuybackDetail(buyback).cents / 100).toFixed(2), currency: "USD" });
// Buy-backs with the same title and contents line are the same item, and RSI shows the same page for each of them.
// RSI adds a mark to the title of a pledge that had an upgrade applied, so that one is an item of its own.
export const sameItem = (left, right) => left.title === right.title && left.contains === right.contains && left.upgraded === right.upgraded;
// The first listed buy-back of an item: the one whose page a build reads for that item.
export const firstOf = (listed, buyback) => listed.find((candidate) => sameItem(candidate, buyback));
export const firstOfEachItem = (listed) => listed.filter((buyback) => firstOf(listed, buyback) === buyback);

export async function assertValid(document) {
  assert.equal(await AccountDocument.verifyIntegrity(structuredClone(document)), true);
  AccountDocument.assertValid(structuredClone(document), globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
}

export async function build(harness, tab) {
  tab.reload();
  const started = await tab.build();
  assert.equal(started.code, "RUN_STARTED", started.message);
  const finished = await harness.finishJob();
  return { started, finished, document: finished.status === "complete" ? resultOf(tab) : null };
}

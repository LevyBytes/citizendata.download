import assert from "node:assert/strict";
import { createExtensionHarness } from "../support/extension-harness.mjs";

await import("../../docs/scripts/account-document.js");
await import("../../docs/schema/account-export.schema.js");
const AccountDocument = globalThis.CitizenDataAccountDocument;

const SMALL = { counts: { pledges: 12, buybacks: 24, orders: 5, storeCredit: 5, uec: 3, rec: 2, olderHangarLogRows: 5, prospects: 5, recruits: 2, legacyRecruits: 1, organizationMembers: 5 } };
export const plain = (value) => JSON.parse(JSON.stringify(value));
export const resultOf = (tab) => plain(tab.events.filter((event) => event.result).at(-1)?.result ?? null);
export const counts = (overrides = {}) => ({ status: "compared", reason: null, missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept: 0, ...overrides });
// What the backup records for a list this build did not ask RSI for, because the Hangar Log held nothing new.
export const notRead = (kept = 0) => ({ status: "not-compared", reason: "list-not-read", missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept });
export const listRequests = (requests) => requests.filter((request) => ["/account/pledges", "/api/account/buybackPledges"].includes(request.path));

export async function assertValid(document) {
  assert.equal(await AccountDocument.verifyIntegrity(structuredClone(document)), true);
  AccountDocument.assertValid(structuredClone(document), globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
}

export async function build(harness, tab) {
  tab.reload();
  const started = await tab.build();
  assert.equal(started.code, "RUN_STARTED", started.message);
  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete", JSON.stringify((await tab.status()).activeJob?.failure));
  const document = resultOf(tab);
  await assertValid(document);
  return document;
}

export async function account() {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const first = await build(harness, tab);
  // An ordinary buy-back and a pledge, each somewhere inside its list.
  const buyback = harness.rsi.state.buybacks[5];
  const pledge = harness.rsi.state.pledges[4];
  assert.equal(buyback.upgrade, null);
  return { harness, tab, first, buyback, pledge };
}

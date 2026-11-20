import assert from "node:assert/strict";
import test from "node:test";
import { Exports, fixture, native } from "./account-exports-loaded-with-fixture-account.mjs";

test("malformed selected shapes reject the entire download", () => {
  const cases = [
    ["inventory", document => { document.pledges = null; }],
    ["inventory", document => { document.pledges[0].items = {}; }],
    ["inventory", document => { document.pledges[0].images = [null]; }],
    ["inventory", document => { document.pledges[0].recordKey = ""; }],
    ["referrals", document => { document.referrals.current.recruits = {}; }],
    ["referrals", document => { document.referrals.current.prospects[0].handle = 4; }],
    ["hangar-log", document => { document.hangarLog = {}; }],
    ["hangar-log", document => { document.hangarLog.push(null); }],
    ["hangar-log", document => { delete document.hangarLog[0].rawDetail; }],
    ["hangar-log", document => { document.hangarLog[0].subjectId = Number.MAX_SAFE_INTEGER + 1; }],
    ["billing", document => { document.financial = null; }],
    ["billing", document => { document.financial.orders = {}; }],
    ["billing", document => { document.financial.orders = [null]; }],
    ["billing", document => { document.financial.orders[0].items = ["bad"]; }],
    ["billing", document => { document.financial.orders[0].items[0].quantity = -1; }],
    ["billing", document => { document.financial.orders[0].total.amount = 19.99; }],
    ["billing", document => { document.financial.orders[0].total.amount = "1e2"; }],
    ["billing", document => { document.financial.orders[0].total.amount = "NaN"; }],
    ["billing", document => { document.financial.creditLedgers.rec = null; }],
    ["billing", document => { document.financial.creditLedgers.storeCredit[0].amount = 2; }],
    ["billing", document => { document.financial.subscriptions[0].payments = [false]; }],
    ["billing", document => { document.financial.billingTotal.source = "sumOfOrders"; }]
  ];
  for (const [preset, mutate] of cases) {
    const document = fixture();
    mutate(document);
    const result = Exports.inspectExport(document, { preset });
    assert.equal(result.canExport, false, `${preset}: ${mutate}`);
    assert.equal(result.errors.length, 1);
    assert.throws(() => Exports.createExport(document, { preset }));
  }
});

test("only selected sections are validated and exported", () => {
  const document = fixture();
  document.financial = null;
  document.hangarLog = [null];
  assert.deepEqual(native(document, { preset: "inventory", inventoryScope: "hangar" }), { pledges: document.pledges });
});

test("invalid options do not silently select a different export", () => {
  const selections = [
    null, {}, { preset: "all" }, { preset: "inventory", inventoryScope: "other" }, { preset: "inventory", format: "fleetview" },
    { preset: "referrals", referralLadder: "other" }, { preset: "referrals", referralKind: "other" }, { preset: "billing", format: "hangar-link" }, { preset: "custom" },
    { preset: "custom", sections: [] }, { preset: "custom", sections: ["account"] }, { preset: "custom", sections: "hangar" }, { preset: "inventory", example: "true" }
  ];
  for (const selection of selections) {
    assert.equal(Exports.inspectExport(fixture(), selection).canExport, false);
    assert.throws(() => Exports.createExport(fixture(), selection));
  }
});

test("JSON-unsafe and oversized selected values are rejected rather than silently changed", () => {
  const values = [undefined, NaN, Infinity, 1n, () => {}, new Date(), Symbol("bad")];
  for (const value of values) {
    const document = fixture();
    document.pledges[0].extra = value;
    assert.equal(Exports.inspectExport(document, { preset: "inventory" }).canExport, false, String(value));
  }
  for (const extra of [Array(2), { loop: null }, { text: "a".repeat(1024 * 1024 + 1) }, Array(200001).fill(null)]) {
    const document = fixture();
    if (Object.hasOwn(extra, "loop")) extra.loop = extra;
    document.pledges[0].extra = extra;
    assert.equal(Exports.inspectExport(document, { preset: "inventory" }).canExport, false);
  }
  const document = fixture();
  let nested = {};
  for (let index = 0; index < 65; index += 1) nested = { child: nested };
  document.pledges[0].extra = nested;
  assert.match(Exports.inspectExport(document, { preset: "inventory" }).errors[0], /nesting/u);
});

import assert from "node:assert/strict";
import test from "node:test";
import { Exports, SafeJson, fixture, native } from "./account-exports-loaded-with-fixture-account.mjs";

test("billing preserves exact amounts, nulls, billing total, and optional unknown fields", () => {
  const document = fixture();
  document.financial.futureField = { pending: true };
  const result = native(document, { preset: "billing" });
  assert.deepEqual(result, { financial: document.financial });
  assert.equal(result.financial.billingTotal.amount, "9007199254740993.1250");
  assert.equal(result.financial.balances.storeCredit.amount, "0.0000");
  assert.equal(result.financial.balances.uec, null);
  assert.equal(Exports.inspectExport(document, { preset: "billing" }).recordCount, 7);
  document.financial = { balances: {}, billingTotal: null };
  assert.deepEqual(native(document, { preset: "billing" }), { financial: { balances: {}, billingTotal: null } });
});

test("custom selections keep only requested keys and raw log fields", () => {
  const document = fixture();
  const result = native(document, { preset: "custom", sections: ["billing", "hangar-log", "referrals", "hangar", "buybacks", "hangar"] });
  assert.deepEqual(Object.keys(result), ["pledges", "buybacks", "referrals", "hangarLog", "financial"]);
  assert.deepEqual(result.hangarLog, native(document, { preset: "hangar-log" }));
  assert.deepEqual(native(document, { preset: "custom", sections: ["buybacks"] }), { buybacks: document.buybacks });
  for (const key of ["account", "profile", "schemaVersion", "sync", "integrity", "unrelated"]) assert.equal(Object.hasOwn(result, key), false);
});

test("known empty sections export, while absent selected sections fail without invented arrays", () => {
  for (const [preset, key, expected] of [["hangar-log", "hangarLog", []], ["inventory", "pledges", { pledges: [] }]]) {
    const document = { [key]: [] };
    const selection = { preset, inventoryScope: "hangar" };
    assert.deepEqual(native(document, selection), expected);
    assert.equal(Exports.inspectExport(document, selection).recordCount, 0);
    delete document[key];
    assert.equal(Exports.inspectExport(document, selection).canExport, false);
    assert.throws(() => Exports.createExport(document, selection), /must be an array/u);
  }
});

test("coverage warnings do not block included data or imply complete billing history", () => {
  const document = fixture();
  document.sync.sectionOutcomes.pledges = { status: "complete" };
  const selected = { preset: "inventory", inventoryScope: "hangar" };
  assert.deepEqual(Exports.inspectExport(document, selected).warnings, []);
  for (const status of ["failed", "skipped", "notRun", "partial"]) {
    document.sync.sectionOutcomes.pledges.status = status;
    const result = Exports.inspectExport(document, selected);
    assert.equal(result.canExport, true);
    assert.deepEqual(result.warnings, ["Partial source"]);
  }
  document.sync.sectionOutcomes["financial.balances"] = { status: "complete" };
  assert.deepEqual(Exports.inspectExport(document, { preset: "billing" }).warnings, ["Completeness unknown"]);
  assert.deepEqual(Exports.inspectExport(document, { ...selected, example: true }).warnings, ["Example data"]);
});

test("all bundled demo native presets export without assuming full canonical schema fields", () => {
  const document = globalThis.CITIZENDATA_DEMO_DATA;
  for (const preset of ["inventory", "referrals", "hangar-log", "billing", "custom"]) {
    const selection = { preset, example: true, sections: ["hangar", "buybacks", "referrals", "hangar-log", "billing"] };
    const inspection = Exports.inspectExport(document, selection);
    assert.equal(inspection.canExport, true, `${preset}: ${inspection.errors.join(" ")}`);
    assert.deepEqual(inspection.warnings, ["Example data"]);
    assert.match(inspection.fileName, /^citizendata-example-[a-z-]+-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}Z\.json$/u);
    assert.deepEqual(SafeJson.parseBoundedJson(Exports.createExport(document, selection).text), native(document, selection));
  }
});

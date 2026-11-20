import assert from "node:assert/strict";
import test from "node:test";
import { Exports, deepFreeze, fixture, native } from "./account-exports-loaded-with-fixture-account.mjs";

test("exports are detached text snapshots and never mutate frozen source data or options", () => {
  const document = deepFreeze(fixture());
  const selection = deepFreeze({ preset: "custom", sections: ["billing", "hangar", "hangar-log"] });
  const before = JSON.stringify(document);
  const result = Exports.createExport(document, selection);
  assert.equal(result.mimeType, "application/json");
  assert.equal(result.text.endsWith("\n"), true);
  assert.equal(result.text.includes("\r"), false);
  assert.equal(JSON.stringify(document), before);
  const exported = JSON.parse(result.text);
  exported.pledges[0].title = "Changed locally";
  assert.equal(document.pledges[0].title, "Package");
  assert.equal(result.fileName.includes("PrivateHandle"), false);
});

test("Hangar Link delegates only inventory and refuses missing or invalid adapters", () => {
  const previous = globalThis.CitizenDataHangarLinkExport;
  const selection = { preset: "inventory", inventoryScope: "buybacks", format: "hangar-link" };
  try {
    delete globalThis.CitizenDataHangarLinkExport;
    assert.match(Exports.inspectExport(fixture(), selection).errors[0], /did not load/u);
    let called = 0;
    globalThis.CitizenDataHangarLinkExport = { prepareExport(document, options) {
      called += 1;
      assert.deepEqual(options, { inventoryScope: "buybacks" });
      assert.equal(document.buybacks[0].recordKey, "buyback-1");
      return { payload: { compatible: true }, recordCount: 1, warnings: ["Adapter warning"] };
    } };
    assert.deepEqual(native(fixture(), selection), { compatible: true });
    assert.equal(called, 1);
    assert.equal(Exports.inspectExport(fixture(), selection).warnings.includes("Adapter warning"), true);
    assert.match(Exports.createExport(fixture(), selection).fileName, /buybacks-hangar-link-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}Z\.json$/u);
    globalThis.CitizenDataHangarLinkExport = { prepareExport() { return { payload: {}, recordCount: "1", warnings: [] }; } };
    assert.equal(Exports.inspectExport(fixture(), selection).canExport, false);
    globalThis.CitizenDataHangarLinkExport = { prepareExport() { throw new Error("Required ship mapping unavailable."); } };
    assert.match(Exports.inspectExport(fixture(), selection).errors[0], /mapping unavailable/u);
  } finally {
    if (previous === undefined) delete globalThis.CitizenDataHangarLinkExport;
    else globalThis.CitizenDataHangarLinkExport = previous;
  }
});

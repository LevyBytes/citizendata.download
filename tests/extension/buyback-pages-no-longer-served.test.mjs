import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { SMALL, assertValid, build, firstOf, ordinary, pageIds, sameItem, shownPrice } from "./buyback-pages-loaded-with-fixture-build.mjs";

test("a buy-back page RSI no longer serves is noted, the item's next buy-back is read in its place, and an item left without a page is asked for again on the next build", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const listed = ordinary(harness.rsi);
  // The first is the first of two buy-backs of its item; the others are the only buy-backs of theirs.
  const [missing, moved, gone] = [listed[2], listed[7], listed[5]];
  const second = listed.find((buyback) => buyback !== missing && sameItem(buyback, missing));
  assert.ok(second && [moved, gone].every((alone) => firstOf(listed, alone) === alone && !listed.some((buyback) => buyback !== alone && sameItem(buyback, alone))));
  // Two pages answer 404, and one sends the reader on to the store.
  harness.rsi.state.buybackPagesMissing.add(missing.id).add(gone.id);
  harness.rsi.state.buybackPagesRedirected.add(moved.id);
  const { finished, document } = await build(harness, tab);
  assert.equal(finished.status, "complete", "a missing page does not fail the build");
  await assertValid(document);
  const asked = pageIds(harness.rsi.requests);
  assert.deepEqual([missing, moved, gone, second].map((buyback) => asked.filter((id) => id === buyback.id).length), [1, 1, 1, 1], "each is asked for once in the run, and the item's second buy-back in place of its first");
  // The item with a second buy-back has its price under both; the two items without one have none.
  assert.equal(document.buybackDetails.length, listed.length - 2);
  assert.ok(!document.buybackDetails.some((detail) => [moved.id, gone.id].includes(detail.buybackId)));
  assert.deepEqual([missing, second].map((buyback) => document.buybackDetails.find((detail) => detail.buybackId === buyback.id).readFromBuybackId), [second.id, undefined]);
  assert.deepEqual([missing, second, moved, gone].map((buyback) => document.buybacks.find((record) => record.buybackId === buyback.id).buybackPrice), [shownPrice(missing), shownPrice(missing), null, null]);
  assert.deepEqual(document.sync.sectionOutcomes.buybackDetails.warnings, ["2 buy-back pages were not available; their price was not captured."]);
  assert.deepEqual(document.dataQuality.anomalies.map((anomaly) => [anomaly.section, anomaly.issueCode, anomaly.raw, anomaly.retainedInNormalizedData]).sort((left, right) => left[2].buybackId - right[2].buybackId), [
    ["buybackDetails", "BUYBACK_PAGE_UNAVAILABLE", { buybackId: missing.id, reason: "HTTP_404" }, false],
    ["buybackDetails", "BUYBACK_PAGE_UNAVAILABLE", { buybackId: moved.id, reason: "REDIRECTED" }, false],
    ["buybackDetails", "BUYBACK_PAGE_UNAVAILABLE", { buybackId: gone.id, reason: "HTTP_404" }, false]
  ].sort((left, right) => left[2].buybackId - right[2].buybackId));

  // RSI serves them all again. The next build reads the pages of the two items that have no detail, and no other.
  harness.rsi.state.buybackPagesMissing.clear();
  harness.rsi.state.buybackPagesRedirected.clear();
  const before = harness.rsi.requests.length;
  const next = (await build(harness, tab)).document;
  assert.deepEqual(pageIds(harness.rsi.requests.slice(before)).sort(), [moved.id, gone.id].sort());
  assert.deepEqual(next.buybackDetails.map((detail) => detail.buybackId), listed.map((buyback) => buyback.id));
  assert.deepEqual(next.sync.sectionOutcomes.buybackDetails.warnings, []);
  await assertValid(next);
});

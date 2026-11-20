import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { SMALL, assertValid, build, ordinary, pageIds, shownPrice } from "./buyback-pages-loaded-with-fixture-build.mjs";

test("a later build reads only the pages of items that have no captured detail yet", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const first = (await build(harness, tab)).document;

  // Nothing changed: no buy-back page is read, and every detail is kept as it was captured.
  let before = harness.rsi.requests.length;
  const second = (await build(harness, tab)).document;
  assert.deepEqual(pageIds(harness.rsi.requests.slice(before)), []);
  assert.deepEqual(second.buybackDetails, first.buybackDetails);
  assert.deepEqual(second.sync.sectionOutcomes.buybackDetails, first.sync.sectionOutcomes.buybackDetails);
  await assertValid(second);

  // A pledge is melted, so one new buy-back appears. Only its page is read.
  const melted = harness.rsi.meltPledge(harness.rsi.state.pledges[1].id);
  assert.equal(melted.upgrade, null);
  before = harness.rsi.requests.length;
  const third = (await build(harness, tab)).document;
  assert.deepEqual(pageIds(harness.rsi.requests.slice(before)), [melted.id]);
  assert.deepEqual(third.buybackDetails.map((detail) => detail.buybackId), ordinary(harness.rsi).map((buyback) => buyback.id), "details follow the buy-back list, newest first");
  assert.deepEqual(third.buybackDetails.slice(1), first.buybackDetails, "details captured earlier keep their capture time");
  assert.ok(Date.parse(third.buybackDetails[0].capturedAt) > Date.parse(first.buybackDetails[0].capturedAt));
  assert.deepEqual(third.buybacks[0].buybackPrice, shownPrice(melted));
  assert.equal(third.sync.sectionOutcomes.buybackDetails.records, first.buybackDetails.length + 1);
  await assertValid(third);

  // A buy-back is bought back and leaves the list. Its detail leaves the backup with it, and no page is read.
  const gone = harness.rsi.buyBack(ordinary(harness.rsi)[3].id);
  before = harness.rsi.requests.length;
  const fourth = (await build(harness, tab)).document;
  assert.deepEqual(pageIds(harness.rsi.requests.slice(before)), []);
  assert.ok(!fourth.buybacks.some((record) => record.buybackId === gone.id) && !fourth.buybackDetails.some((detail) => detail.buybackId === gone.id));
  assert.equal(fourth.buybackDetails.length, third.buybackDetails.length - 1);
  assert.equal(fourth.sync.sectionOutcomes.buybackDetails.records, fourth.buybackDetails.length);
  await assertValid(fourth);

  // RSI lists one more buy-back of an item the backup already holds, and its Hangar Log names it. No page is read:
  // it takes the captured detail.
  const known = ordinary(harness.rsi)[5];
  const another = { ...known, id: 29000001, date: "October 5, 2026" };
  harness.rsi.state.buybacks.unshift(another);
  harness.rsi.state.hangarLog.unshift({ when: "Oct 5 2026, 10:10 am", id: another.id, name: another.title, detail: harness.rsi.state.hangarLog.find((row) => row.id === melted.id).detail });
  before = harness.rsi.requests.length;
  const fifth = (await build(harness, tab)).document;
  assert.deepEqual(pageIds(harness.rsi.requests.slice(before)), []);
  const [given, held] = [fifth.buybackDetails.find((detail) => detail.buybackId === another.id), fifth.buybackDetails.find((detail) => detail.buybackId === known.id)];
  assert.deepEqual(given, { ...held, buybackId: another.id, recordKey: `buyback-detail:${another.id}`, sourceUrl: `https://robertsspaceindustries.com/en/pledge/buyback/${another.id}`, readFromBuybackId: held.readFromBuybackId ?? known.id });
  assert.deepEqual(fifth.buybacks.find((record) => record.buybackId === another.id).buybackPrice, shownPrice(known));
  assert.equal(fifth.sync.sectionOutcomes.buybackDetails.records, fourth.buybackDetails.length + 1);
  await assertValid(fifth);
});

import assert from "node:assert/strict";
import test from "node:test";
import { AccountDocument, Assembler, account, buyback, complete, detail, details, first, listed, now } from "./document-assembler-loaded-with-fixture-sections.mjs";

test("captured buy-back details follow the buy-back list and put each price on its buy-back", async () => {
  const assembled = await Assembler.assemble({ account, exportedAt: now, results: [first, listed([3, 1, 2]), details([detail(1, "10.00"), detail(2, null), detail(3, "30.00")])] });
  const document = assembled.document;
  assert.deepEqual(document.buybackDetails.map((entry) => entry.buybackId), [3, 1, 2], "details are kept in the order of the list");
  // A page that showed no price leaves the buy-back without one.
  assert.deepEqual(document.buybacks.map((entry) => [entry.buybackId, entry.buybackPrice]), [[3, { amount: "30.00", currency: "USD" }], [1, { amount: "10.00", currency: "USD" }], [2, null]]);
  assert.equal(document.sync.sectionOutcomes.buybackDetails.records, 3);
  assert.equal(await AccountDocument.verifyIntegrity(document), true);
  AccountDocument.assertValid(document, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
});

test("a later run adds the details it read to the ones already captured, and drops those of buy-backs that are gone", async () => {
  const later = "2026-11-18T12:00:00.000Z";
  const baseline = (await Assembler.assemble({ account, exportedAt: now, results: [first, listed([1, 2, 3]), details([detail(1, "10.00"), detail(2, "20.00"), detail(3, "30.00")])] })).document;
  // Buy-back 2 left the list and 4 is new. The run read only the page of 4.
  const updated = (await Assembler.assemble({ account, exportedAt: later, previous: baseline, results: [listed([4, 1, 3]), details([detail(4, "40.00", later)])] })).document;
  assert.deepEqual(updated.buybackDetails.map((entry) => [entry.buybackId, entry.capturedAt]), [[4, later], [1, now], [3, now]]);
  assert.deepEqual(updated.buybacks.map((entry) => entry.buybackPrice?.amount ?? null), ["40.00", "10.00", "30.00"], "the list is read without prices; each is taken from its captured detail");
  assert.equal(updated.sync.sectionOutcomes.buybackDetails.records, 3);
  AccountDocument.assertValid(updated, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);

  // A run that read no page at all still drops the detail of a buy-back that left the list.
  const pruned = (await Assembler.assemble({ account, exportedAt: later, previous: updated, results: [listed([4, 3])] })).document;
  assert.deepEqual(pruned.buybackDetails.map((entry) => entry.buybackId), [4, 3]);
  assert.equal(pruned.sync.sectionOutcomes.buybackDetails.records, 2);
  assert.equal(await AccountDocument.verifyIntegrity(pruned), true);

  // A page read again replaces the earlier capture of the same buy-back.
  const reread = (await Assembler.assemble({ account, exportedAt: later, previous: baseline, results: [details([detail(2, "25.00", later)])] })).document;
  assert.deepEqual(reread.buybackDetails.map((entry) => [entry.buybackId, entry.price.amount]), [[1, "10.00"], [2, "25.00"], [3, "30.00"]]);
  assert.equal(reread.buybacks[1].buybackPrice.amount, "25.00");
});

test("details captured under another version number are kept, and a backup without the section stays without it", async () => {
  const baseline = (await Assembler.assemble({ account, exportedAt: now, results: [first, listed([1, 2]), details([detail(1, "10.00"), detail(2, "20.00")], { parserVersion: "0.9.0" })] })).document;
  // The run read one page again. The detail the saved backup holds for the other buy-back stays: a version number
  // alone drops nothing.
  const replaced = (await Assembler.assemble({ account, exportedAt: now, previous: baseline, results: [details([detail(1, "11.00")])] })).document;
  assert.deepEqual(replaced.buybackDetails.map((entry) => [entry.buybackId, entry.price.amount]), [[1, "11.00"], [2, "20.00"]]);
  assert.equal(replaced.sync.sectionOutcomes.buybackDetails.parserVersion, "1.0.0");
  const without = (await Assembler.assemble({ account, exportedAt: now, results: [first, listed([1, 2])] })).document;
  assert.equal(Object.hasOwn(without, "buybackDetails"), false);
  assert.equal(without.sync.sectionOutcomes.buybackDetails, undefined);
  AccountDocument.assertValid(without, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
});

test("a record kept from an earlier build loses RSI's placeholder picture and keeps its own images", async () => {
  const reference = (url, key) => ({ imageKey: key.repeat(64), normalizationVersion: 1, role: "thumbnail", url, altText: null, width: null, height: null, mimeTypeHint: null });
  const ship = reference("https://media.robertsspaceindustries.com/abc/store_small/ship.jpg", "a");
  const placeholder = reference("https://cdn.robertsspaceindustries.com/static/images/Temp/default-image.png", "b");
  const baseline = await Assembler.assemble({ account, exportedAt: now, results: [first, { section: "buybacks", value: [buyback(1, { images: [ship] })], outcome: { ...complete, parserVersion: "1.3.0" } }] });
  const earlier = structuredClone(baseline.document);
  earlier.buybacks[0].images = [ship, placeholder];
  const previous = await AccountDocument.stampIntegrity(earlier);
  const rerun = await Assembler.assemble({ account, exportedAt: "2026-11-17T13:00:00.000Z", previous, results: [first] });
  assert.deepEqual(rerun.document.buybacks[0].images, [ship]);
  assert.equal(await AccountDocument.verifyIntegrity(rerun.document), true);
});

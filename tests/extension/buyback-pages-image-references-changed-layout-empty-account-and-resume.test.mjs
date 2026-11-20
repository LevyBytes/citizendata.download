import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { SMALL, assertValid, build, firstOfEachItem, ordinary, pageIds, pageRequests, plain, resultOf } from "./buyback-pages-loaded-with-fixture-build.mjs";

test("every image of a finished build, buy-back pages included, is referenced by a record type the Images ZIP accepts", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const { document } = await build(harness, harness.openTab());
  await import("../../docs/scripts/media-materializer.js");
  const { readFile } = await import("node:fs/promises");
  const schema = JSON.parse(await readFile(new URL("../../schema/offline-package.schema.json", import.meta.url), "utf8"));
  const accepted = schema.$defs.entityReference.properties.recordType.enum;
  const references = globalThis.CitizenDataMediaMaterializer.collectImageReferences(document).map((item) => item.reference);
  assert.deepEqual([...new Set(references.map((reference) => reference.recordType))].filter((type) => !accepted.includes(type)), []);
  // The buy-back pages of this build do carry images, of the item and of its ships.
  const fromPages = references.filter((reference) => reference.recordKey.startsWith("buyback-detail:"));
  assert.ok(fromPages.some((reference) => reference.role === "detail") && fromPages.some((reference) => reference.role === "ship"));
  assert.ok(fromPages.every((reference) => reference.recordType === "buyback"));
});

test("a buy-back page whose layout changed stops the build instead of recording empty details", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  harness.rsi.state.buybackPagesWithoutHeading.add(ordinary(harness.rsi)[0].id);
  const { finished } = await build(harness, tab);
  assert.equal(finished.status, "failed");
  const failure = tab.lastEvent();
  assert.equal(failure.status.activeJob.failure.code, "RSI_READ_FAILED");
  assert.match(failure.status.activeJob.failure.message, /RSI_BUYBACK_DETAIL_CONTRACT_CHANGED/u);
  // The account data read before it is intact in the partial backup.
  const partial = plain((await tab.request("GET_PARTIAL_RESULT")).partialResult);
  await assertValid(partial);
  assert.equal(partial.sync.sectionOutcomes.buybacks.status, "complete");
  assert.equal(partial.pledges.length, harness.rsi.state.pledges.length);
});

test("an account with no ordinary buy-backs finishes the section without a request", async () => {
  const harness = await createExtensionHarness({ account: { counts: { ...SMALL.counts, buybacks: 0 } } });
  const tab = harness.openTab();
  const { finished, document } = await build(harness, tab);
  assert.equal(finished.status, "complete");
  assert.deepEqual(pageIds(harness.rsi.requests), []);
  assert.deepEqual([document.buybackDetails, document.sync.sectionOutcomes.buybackDetails.status, document.sync.sectionOutcomes.buybackDetails.records], [[], "complete", 0]);
  await assertValid(document);
});

test("a build stopped by Chrome while reading buy-back pages resumes from the pages it stored", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const listed = ordinary(harness.rsi);
  tab.reload();
  await tab.build();
  // Chrome stops the worker after the tenth page was read; the watchdog alarm starts it again.
  await harness.advance(() => pageRequests(harness.rsi.requests).length >= 10);
  harness.stopWorker();
  assert.equal((await harness.finishJob()).status, "complete");
  const counts = new Map();
  for (const id of pageIds(harness.rsi.requests)) counts.set(id, (counts.get(id) ?? 0) + 1);
  assert.deepEqual([...counts.keys()], firstOfEachItem(listed).map((buyback) => buyback.id));
  assert.ok([...counts.values()].filter((count) => count > 1).length <= 2 && Math.max(...counts.values()) <= 2, "at most the step in flight is read a second time");
  const document = resultOf(tab);
  assert.deepEqual(document.buybackDetails.map((detail) => detail.buybackId), listed.map((buyback) => buyback.id));
  await assertValid(document);
});

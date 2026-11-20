import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { PAGE, SMALL, assertValid, build, firstOfEachItem, ordinary, pageIds, plain, resultOf, sameItem } from "./buyback-pages-loaded-with-fixture-build.mjs";

test("a failure while reading buy-back pages leaves everything else complete, and continuing reads only the pages not yet read", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const listed = ordinary(harness.rsi);
  // RSI fails on the ninth page asked for.
  harness.rsi.failNext((request) => request.path === `/pledge/buyback/${listed[8].id}`, { status: 503 });
  const { finished } = await build(harness, tab);
  assert.equal(finished.status, "failed");
  const failure = tab.lastEvent();
  assert.equal(failure.status.activeJob.currentSection, "buybackDetails");
  assert.match(failure.status.activeJob.failure.message, /RSI_HTML_HTTP_503/u);
  assert.equal(failure.status.continuable, true);
  // The step would have read two pages. The second had not been asked for when the first failed, and it never is.
  const atFailure = harness.rsi.requests.length;
  await harness.advanceBy(5000);
  assert.equal(harness.rsi.requests.length, atFailure, "a failed run sends nothing further");
  assert.deepEqual(pageIds(harness.rsi.requests), listed.slice(0, 9).map((buyback) => buyback.id));

  // The partial backup has every other section complete, and the details read before the failure: those of the
  // first eight items, under every buy-back of each.
  const partial = plain((await tab.request("GET_PARTIAL_RESULT")).partialResult);
  await assertValid(partial);
  assert.deepEqual(Object.entries(partial.sync.sectionOutcomes).filter(([, outcome]) => outcome.status !== "complete").map(([section, outcome]) => [section, outcome.status]), [["buybackDetails", "partial"]]);
  assert.equal(partial.buybacks.length, harness.rsi.state.buybacks.length);
  const priced = listed.filter((buyback) => listed.slice(0, 8).some((read) => sameItem(read, buyback)));
  assert.ok(priced.length > 8, "some of the eight items have a second buy-back");
  assert.deepEqual(partial.buybackDetails.map((detail) => detail.buybackId), priced.map((buyback) => buyback.id));
  assert.deepEqual(partial.buybacks.filter((record) => record.buybackPrice).map((record) => record.buybackId), priced.map((buyback) => buyback.id));

  const before = harness.rsi.requests.length;
  const continued = await tab.request("CONTINUE_PARTIAL");
  assert.equal(continued.code, "RUN_STARTED", continued.message);
  assert.equal((await harness.finishJob()).status, "complete");
  const after = harness.rsi.requests.slice(before);
  // Pages are read two at a step and stored a step at a time, so the step that failed is read again and no other.
  assert.deepEqual(pageIds(after), firstOfEachItem(listed).slice(8).map((buyback) => buyback.id));
  // What follows the pages is the section after them, the CCU buy-back prices, which had not started.
  const upgradeCalls = ["/api/account/v2/setAuthToken", "/api/ship-upgrades/setContextToken", "/pledge-store/api/upgrade/graphql"];
  assert.ok(after.filter((request) => !PAGE.test(request.path) && !upgradeCalls.includes(request.path)).every((request) => request.path === "/api/spectrum/auth/identify"), "finished sections are not collected again");
  const document = resultOf(tab);
  await assertValid(document);
  assert.deepEqual(document.buybackDetails.map((detail) => detail.buybackId), listed.map((buyback) => buyback.id));
  assert.deepEqual(document.buybackDetails.filter((detail) => priced.some((buyback) => buyback.id === detail.buybackId)), partial.buybackDetails, "details read before the failure are kept as captured");
});

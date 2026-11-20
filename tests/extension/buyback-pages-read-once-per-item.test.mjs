import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { PAGE, SMALL, assertValid, build, buildBuybackDetail, firstOf, firstOfEachItem, ordinary, pageIds, pageRequests, shownPrice } from "./buyback-pages-loaded-with-fixture-build.mjs";

test("a build reads one buy-back page for each item, after everything else, and records what it shows for every buy-back of the item", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const { started, finished, document } = await build(harness, tab);
  assert.equal(finished.status, "complete");
  assert.deepEqual(started.status.activeJob.selectedSections.slice(-2), ["buybackDetails", "buybackUpgradePrices"], "buy-back pages are read after everything else, and the CCU buy-back prices after them");
  await assertValid(document);

  const listed = ordinary(harness.rsi);
  assert.ok(listed.length > 0 && listed.length < harness.rsi.state.buybacks.length, "the account has ordinary buy-backs and upgrades");
  // One GET for each item, for its first listed buy-back; none for a further buy-back of the same item and none
  // for an upgrade; without the session token, and nothing after them.
  const firsts = firstOfEachItem(listed);
  assert.ok(firsts.length < listed.length, "the account has more than one buy-back of some item");
  const requests = harness.rsi.requests;
  assert.deepEqual(pageIds(requests), firsts.map((buyback) => buyback.id));
  assert.ok(pageRequests(requests).every((request) => request.method === "GET" && !request.tokenSent && request.redirectedTo === `/en${request.path}`));
  const afterFirstPage = requests.slice(requests.indexOf(pageRequests(requests)[0])).map((request) => request.path);
  const storeUpgradeCalls = ["/api/account/v2/setAuthToken", "/api/ship-upgrades/setContextToken", "/pledge-store/api/upgrade/graphql"];
  assert.ok(afterFirstPage.every((path) => PAGE.test(path) || storeUpgradeCalls.includes(path)), "nothing but the CCU buy-back prices is read after the buy-back pages");
  assert.ok(afterFirstPage.findLastIndex((path) => PAGE.test(path)) < afterFirstPage.findIndex((path) => storeUpgradeCalls.includes(path)), "the CCU buy-back prices are read after the last buy-back page");
  // Nothing was asked of the cart. The one store address is the price query of the store upgrade page, for the
  // CCU buy-backs; every other request is one of the account's own lists.
  assert.deepEqual([...new Set(requests.map((request) => request.path.replace(/[0-9]+$/u, "#")))].filter((path) => path.startsWith("/pledge")), ["/pledge/buyback/#", "/pledge-store/api/upgrade/graphql"]);

  // Every buy-back has a detail, in the order of the buy-back list: what the item's page showed, under the
  // buy-back's own number and page address. A buy-back whose own page was not read names the one whose page was.
  assert.deepEqual(document.buybackDetails.map((detail) => detail.buybackId), listed.map((buyback) => buyback.id));
  for (const [index, buyback] of listed.entries()) {
    const shown = buildBuybackDetail(buyback);
    const detail = document.buybackDetails[index];
    const first = firstOf(listed, buyback);
    assert.equal(detail.readFromBuybackId, first === buyback ? undefined : first.id, `buy-back ${buyback.id}`);
    assert.equal(detail.capturedAt, document.buybackDetails[listed.indexOf(first)].capturedAt, "the capture time is that of the page that was read");
    assert.deepEqual({
      recordKey: detail.recordKey, title: detail.title, name: detail.name, pageType: detail.pageType, price: detail.price,
      originalPrice: detail.originalPrice, discountPercent: detail.discountPercent, skuId: detail.skuId, description: detail.description,
      ships: detail.ships.map((ship) => [ship.name, ship.manufacturer, ship.focus, ship.shipPageUrl, ship.images.length]),
      alsoContains: detail.alsoContains, images: detail.images.map((image) => image.url), buybackTokensAvailable: detail.buybackTokensAvailable, sourceUrl: detail.sourceUrl
    }, {
      recordKey: `buyback-detail:${buyback.id}`, title: buyback.title, name: shown.name, pageType: shown.type, price: shownPrice(buyback),
      originalPrice: shown.originalCents === null ? null : { amount: (shown.originalCents / 100).toFixed(2), currency: "USD" }, discountPercent: shown.discountPercent, skuId: String(shown.sku), description: shown.description.join("\n\n"),
      ships: shown.ships.map((ship) => [ship.name, ship.manufacturer, ship.focus, `https://robertsspaceindustries.com${ship.page}`, 1]),
      alsoContains: shown.alsoContains, images: [`https://media.robertsspaceindustries.com/synthetic/buyback-detail-${shown.sku}.jpg`], buybackTokensAvailable: 2, sourceUrl: `https://robertsspaceindustries.com/en/pledge/buyback/${buyback.id}`
    }, `buy-back ${buyback.id}`);
    assert.ok(Date.parse(detail.capturedAt) >= Date.parse(started.status.activeJob.createdAt ?? document.sync.runs[0].startedAt));
  }
  assert.ok(document.buybackDetails.some((detail) => detail.discountPercent !== null) && document.buybackDetails.some((detail) => detail.discountPercent === null));
  assert.ok(document.buybackDetails.some((detail) => detail.ships.length === 0) && document.buybackDetails.some((detail) => detail.pageType === "game-packages"));

  // The buy-back list itself carries the captured price. A CCU buy-back has no page, and its price comes from the
  // section after this one (buyback-upgrade-prices.test.mjs).
  for (const record of document.buybacks) {
    const shown = harness.rsi.state.buybacks.find((buyback) => buyback.id === record.buybackId);
    if (!shown.upgrade) assert.deepEqual(record.buybackPrice, shownPrice(shown), `buy-back ${record.buybackId}`);
  }
  const outcome = document.sync.sectionOutcomes.buybackDetails;
  assert.deepEqual([outcome.status, outcome.records, outcome.warnings, outcome.sourceUrls], ["complete", listed.length, [], undefined]);
  assert.deepEqual(document.dataQuality.anomalies, []);
  // Two pages a step, so the section took half as many steps as it read pages.
  const job = [...harness.repository.inspect().jobs.values()][0];
  assert.equal(job.requestsBySection.buybackDetails, Math.ceil(firsts.length / 2));
  assert.equal(job.httpRequestsBySection.buybackDetails, firsts.length);
});

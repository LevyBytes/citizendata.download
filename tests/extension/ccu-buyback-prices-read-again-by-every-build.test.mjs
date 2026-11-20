import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { SMALL, build, ccus, destinationOf, priceOf, shipImage, shown, upgradeCalls } from "./ccu-buyback-prices-loaded-with-fixture-build.mjs";

test("CCU buy-back prices are read again by every build and never kept from the build before", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const first = await build(harness, tab);
  const listed = ccus(harness.rsi);

  // RSI raises its prices. The next build reads every CCU again and shows the new price.
  harness.rsi.state.upgradePriceRise = 500;
  const before = harness.rsi.requests.length;
  const second = await build(harness, tab);
  const update = harness.rsi.requests.slice(before);
  assert.deepEqual(upgradeCalls(update), [1, 2, 2, 2]);
  assert.equal(update.filter((request) => /^\/pledge\/buyback\//u.test(request.path)).length, 0, "buy-back pages are still read once only");
  assert.deepEqual(shown(second), Object.fromEntries(listed.map((buyback) => [buyback.id, priceOf(buyback, 500)])));
  assert.notDeepEqual(shown(second), shown(first));

  // RSI gives no price for one CCU. Its buy-backs show none, not the price of the build before, and no other
  // buy-back of that CCU is tried. The other CCU keeps its reading.
  const [gone, kept] = [listed[0], listed.find((buyback) => buyback.upgrade.fromShipId !== listed[0].upgrade.fromShipId)];
  harness.rsi.state.unpricedUpgradeSkus = [Number(gone.upgrade.toSkuId)];
  const start = harness.rsi.requests.length;
  const third = await build(harness, tab);
  assert.deepEqual(upgradeCalls(harness.rsi.requests.slice(start)), [1, 2, 2, 2]);
  for (const buyback of listed) {
    assert.deepEqual(shown(third)[buyback.id], buyback.upgrade.fromShipId === gone.upgrade.fromShipId ? null : priceOf(kept, 500));
  }
  // The CCU without a price is still listed for the ship it leads to, and its buy-backs still show that ship.
  assert.deepEqual(third.buybackUpgradePrices.map((entry) => [entry.fromShipId, entry.price, entry.nativeAmount, entry.images.length]).sort((left, right) => left[0] - right[0]),
    [[Number(gone.upgrade.fromShipId), null, null, 2], [Number(kept.upgrade.fromShipId), priceOf(kept, 500), Number(priceOf(kept, 500).amount) * 100, 2]].sort((left, right) => left[0] - right[0]));
  assert.equal(destinationOf(third.buybacks.find((record) => record.buybackId === gone.id)), shipImage(gone.upgrade.toShipId));
  const outcome = third.sync.sectionOutcomes.buybackUpgradePrices;
  assert.deepEqual([outcome.status, outcome.records, outcome.warnings], ["complete", 2, ["RSI gave no price for 1 of 2 different CCU buy-backs; it shows no price."]]);
  assert.ok(third.dataQuality.anomalies.some((anomaly) => anomaly.issueCode === "BUYBACK_UPGRADE_PRICE_UNAVAILABLE"));
});

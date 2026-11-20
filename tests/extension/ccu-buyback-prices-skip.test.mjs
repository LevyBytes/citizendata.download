import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { AccountDocument, PRICE, SMALL, build, calls, ccus, destinationOf, priceOf, resultOf, shipImage, shown, sourceOf, upgradeCalls } from "./ccu-buyback-prices-loaded-with-fixture-build.mjs";

test("Skip ends the reading of CCU buy-back prices where it stands, and the build is complete", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  // A first build reads both CCUs.
  await build(harness, tab);
  const listed = ccus(harness.rsi);
  const [read, unread] = [listed[0], listed.find((buyback) => buyback.upgrade.fromShipId !== listed[0].upgrade.fromShipId)];

  tab.reload();
  const start = harness.rsi.requests.length;
  assert.equal((await tab.build()).code, "RUN_STARTED");
  // While another stage is read, Skip is declined and changes nothing.
  await harness.advance(() => harness.rsi.requests.length > start);
  assert.notEqual((await tab.status()).activeJob.currentSection, "buybackUpgradePrices");
  assert.deepEqual([(await tab.request("SKIP_CCU_PRICES")).ok, (await tab.status()).activeJob.status], [false, "running"]);

  // The price of the first CCU has been asked. The user skips: the CCU in hand is finished and no other is asked.
  await harness.advance(() => calls(harness.rsi.requests.slice(start), PRICE) === 1);
  assert.equal((await tab.status()).activeJob.currentSection, "buybackUpgradePrices");
  const skip = await tab.request("SKIP_CCU_PRICES");
  assert.equal(skip.ok, true, skip.code);
  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete", JSON.stringify((await tab.status()).activeJob?.failure));
  await harness.advanceBy(60000);
  assert.deepEqual(upgradeCalls(harness.rsi.requests.slice(start)), [1, 1, 1, 1]);

  // The build is a complete build: every section is complete, the document is valid, and it is the saved backup.
  const document = resultOf(tab);
  assert.equal(await AccountDocument.verifyIntegrity(structuredClone(document)), true);
  AccountDocument.assertValid(structuredClone(document), globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
  assert.deepEqual([...new Set(Object.values(document.sync.sectionOutcomes).map((outcome) => outcome.status))], ["complete"]);
  const outcome = document.sync.sectionOutcomes.buybackUpgradePrices;
  assert.deepEqual([outcome.status, outcome.records, outcome.warnings], ["complete", 1, ["The CCU buy-back prices were skipped after 1 of 2 were read."]]);

  // The CCU that was read shows its new price. The CCU that was not shows no price, and keeps its ship images.
  assert.deepEqual(document.buybackUpgradePrices.map((entry) => entry.fromShipId), [Number(read.upgrade.fromShipId)]);
  for (const buyback of listed) {
    const record = document.buybacks.find((entry) => entry.buybackId === buyback.id);
    assert.deepEqual(record.buybackPrice, buyback.upgrade.fromShipId === read.upgrade.fromShipId ? priceOf(buyback) : null);
    assert.deepEqual([sourceOf(record), destinationOf(record)], [shipImage(buyback.upgrade.fromShipId), shipImage(buyback.upgrade.toShipId)]);
  }
  assert.equal(document.buybacks.find((entry) => entry.buybackId === unread.id).buybackPrice, null);

  // The next build reads every CCU again.
  const again = await build(harness, tab);
  assert.deepEqual(shown(again), Object.fromEntries(listed.map((buyback) => [buyback.id, priceOf(buyback)])));
  assert.deepEqual(again.sync.sectionOutcomes.buybackUpgradePrices.warnings, []);
});

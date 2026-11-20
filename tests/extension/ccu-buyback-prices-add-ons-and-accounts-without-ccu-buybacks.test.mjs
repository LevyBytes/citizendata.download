import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { PRICE, SMALL, build, calls, ccus, upgradeCalls } from "./ccu-buyback-prices-loaded-with-fixture-build.mjs";

test("an Add-Ons buy-back is never a CCU, whatever its title says: it has a page, and its price is read from it", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const addOn = harness.rsi.state.buybacks.find((buyback) => !buyback.upgrade);
  addOn.title = "Add-Ons - Example Ship Upgrade Kit";
  addOn.contains = "Example Ship Upgrade Kit";
  const document = await build(harness, tab);
  const record = document.buybacks.find((entry) => entry.buybackId === addOn.id);
  assert.deepEqual([record.kind, record.upgrade, record.category === "shipUpgrade"], ["ordinary", null, false]);
  assert.ok(record.sourceLinks.some((link) => link.kind === "detail"));
  assert.ok(record.buybackPrice && /^[0-9]+\.[0-9]{2}$/u.test(record.buybackPrice.amount));
  assert.ok(document.buybackDetails.some((detail) => detail.buybackId === addOn.id));
  assert.equal(calls(harness.rsi.requests, `/pledge/buyback/${addOn.id}`), 1);
  // Only the buy-backs RSI gives a store upgrade button are CCUs.
  assert.deepEqual(document.buybacks.filter((entry) => entry.kind === "upgrade").map((entry) => entry.buybackId).sort(), ccus(harness.rsi).map((buyback) => buyback.id).sort());
});

test("an account with no CCU buy-back reads the list of ships once for its hangar CCUs, and nothing after that", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  harness.rsi.state.buybacks = harness.rsi.state.buybacks.filter((buyback) => !buyback.upgrade);
  const tab = harness.openTab();
  const document = await build(harness, tab);
  // The session is opened, no upgrade is named, and the list is asked: three requests, no price.
  assert.deepEqual(upgradeCalls(harness.rsi.requests), [1, 1, 1, 1]);
  assert.deepEqual(harness.rsi.requests.filter((request) => request.path === PRICE).map((request) => request.operations.join("+")), ["ships"]);
  assert.deepEqual([document.buybackUpgradePrices, document.sync.sectionOutcomes.buybackUpgradePrices.status], [[], "complete"]);
  const sources = (built) => built.pledges.filter((pledge) => pledge.category === "shipUpgrade").map((pledge) => pledge.images.filter((image) => image.role === "upgrade-source").length);
  assert.ok(sources(document).length >= 2 && sources(document).every((count) => count === 1));

  // The next build finds every hangar CCU with that image and asks nothing.
  const before = harness.rsi.requests.length;
  const second = await build(harness, tab);
  assert.deepEqual(upgradeCalls(harness.rsi.requests.slice(before)), [0, 0, 0, 0]);
  assert.deepEqual(sources(second), sources(document));
});

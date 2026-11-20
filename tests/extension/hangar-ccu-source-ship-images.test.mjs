import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { PRICE, SMALL, build, ccus, priceOf, shown } from "./ccu-buyback-prices-loaded-with-fixture-build.mjs";

test("a hangar CCU titled with a ship's earlier name is given the ship RSI now lists as its Mk I", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const names = harness.rsi.state.pledges.filter((pledge) => pledge.title.startsWith("Upgrade - ")).map((pledge) => /^Upgrade - (.+?) to /u.exec(pledge.title)[1]);
  const [renamed, unknown] = names;
  assert.ok(renamed && unknown && renamed !== unknown);
  // RSI lists one ship with a generation mark after its name, and another under a name the title does not lead to.
  harness.rsi.state.upgradeShipRenames = { [renamed]: `${renamed} Mk I`, [unknown]: `Refit ${unknown}` };
  const document = await build(harness, harness.openTab());
  const sourceOfPledge = (name) => document.pledges.find((pledge) => pledge.title.startsWith(`Upgrade - ${name} to `)).images.filter((image) => image.role === "upgrade-source").map((image) => image.altText);
  assert.deepEqual([sourceOfPledge(renamed), sourceOfPledge(unknown)], [[`${renamed} Mk I`], []]);
});

test("a hangar CCU whose ship RSI does not list, or a list RSI refuses, costs nothing but the image", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  harness.rsi.state.upgradeShipListRefused = true;
  const refused = await build(harness, tab);
  assert.equal(refused.sync.sectionOutcomes.buybackUpgradePrices.status, "complete");
  assert.deepEqual(shown(refused), Object.fromEntries(ccus(harness.rsi).map((buyback) => [buyback.id, priceOf(buyback)])));
  assert.ok(refused.pledges.every((pledge) => pledge.images.every((image) => image.role !== "upgrade-source")));

  // The list is given again: the next build reads it for the pledges still without the image.
  harness.rsi.state.upgradeShipListRefused = false;
  const before = harness.rsi.requests.length;
  const again = await build(harness, tab);
  assert.equal(harness.rsi.requests.slice(before).filter((request) => request.path === PRICE && request.operations.join("+") === "ships").length, 1);
  assert.ok(again.pledges.filter((pledge) => pledge.category === "shipUpgrade").every((pledge) => pledge.images[0].role === "upgrade-source"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { PRICE, SMALL, build, ccus, destinationOf, priceOf, shipImage, shown, smallShipImage, upgradeCalls } from "./ccu-buyback-prices-loaded-with-fixture-build.mjs";

test("the ship a CCU leads to is read with its price, once for each different ship, and no price depends on it", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const listed = ccus(harness.rsi);
  const [first, other] = [listed[0], listed.find((buyback) => buyback.upgrade.toShipId !== listed[0].upgrade.toShipId)];

  // RSI's list leaves one ship out. The CCUs that lead to it show no ship image; every price is read as usual.
  harness.rsi.state.unlistedUpgradeShips = [Number(first.upgrade.toShipId)];
  const partial = await build(harness, tab);
  assert.deepEqual(shown(partial), Object.fromEntries(listed.map((buyback) => [buyback.id, priceOf(buyback)])));
  for (const record of partial.buybacks.filter((entry) => entry.kind === "upgrade")) {
    const buyback = listed.find((entry) => entry.id === record.buybackId);
    assert.equal(destinationOf(record), buyback.upgrade.toShipId === first.upgrade.toShipId ? null : shipImage(buyback.upgrade.toShipId));
  }
  // The ship that CCU starts from was listed, so its image is still there.
  assert.deepEqual(partial.buybackUpgradePrices.find((entry) => entry.toShipId === Number(first.upgrade.toShipId)).images.map((image) => [image.role, image.url]), [["upgrade-source", shipImage(first.upgrade.fromShipId)]]);

  // RSI refuses the list. Every price is still read, and an image an earlier build put on a buy-back is gone.
  harness.rsi.state.unlistedUpgradeShips = [];
  harness.rsi.state.upgradeShipListRefused = true;
  const before = harness.rsi.requests.length;
  const refused = await build(harness, tab);
  assert.deepEqual(upgradeCalls(harness.rsi.requests.slice(before)), [1, 2, 2, 2]);
  assert.deepEqual(shown(refused), Object.fromEntries(listed.map((buyback) => [buyback.id, priceOf(buyback)])));
  assert.ok(refused.buybacks.filter((entry) => entry.kind === "upgrade").every((record) => destinationOf(record) === null && record.images.length === 1));
  assert.deepEqual([refused.sync.sectionOutcomes.buybackUpgradePrices.status, refused.sync.sectionOutcomes.buybackUpgradePrices.warnings], ["complete", []]);

  // The list is given again, and the images are back. A ship RSI lists without a larger image shows its small one.
  harness.rsi.state.upgradeShipListRefused = false;
  harness.rsi.state.upgradeShipsWithoutLargeImage = [Number(first.upgrade.toShipId)];
  const again = await build(harness, tab);
  assert.equal(destinationOf(again.buybacks.find((record) => record.buybackId === other.id)), shipImage(other.upgrade.toShipId));
  assert.equal(destinationOf(again.buybacks.find((record) => record.buybackId === first.id)), smallShipImage(first.upgrade.toShipId));

  // A third CCU leads to a ship another CCU already leads to. Its request asks the price only, and it shows that ship.
  harness.rsi.state.upgradeShipsWithoutLargeImage = [];
  const third = listed.filter((buyback) => buyback.upgrade.toShipId === other.upgrade.toShipId).at(-1);
  third.upgrade = { ...third.upgrade, toSkuId: "5999" };
  // The buy-back list is read again only after a new Hangar Log entry. The hangar is read again with it, so the
  // list of ships is read once more for its CCU pledges: one more call that names no upgrade, one more list.
  harness.rsi.addPledges(1);
  let start = harness.rsi.requests.length;
  const shared = await build(harness, tab);
  assert.deepEqual(upgradeCalls(harness.rsi.requests.slice(start)), [1, 4, 4, 3]);
  assert.equal(shared.buybackUpgradePrices.length, 3);
  assert.equal(destinationOf(shared.buybacks.find((record) => record.buybackId === third.id)), shipImage(third.upgrade.toShipId));
  assert.deepEqual(shown(shared)[third.id], priceOf(third));

  // RSI refuses a request that asks for the list with the price. Each price is then asked alone, and read.
  harness.rsi.state.upgradeBatchRefused = true;
  start = harness.rsi.requests.length;
  const alone = await build(harness, tab);
  const posts = harness.rsi.requests.slice(start).filter((request) => request.path === PRICE).map((request) => request.operations.join("+"));
  assert.deepEqual(posts, ["getPrice+ships", "getPrice", "getPrice+ships", "getPrice", "getPrice+ships", "getPrice"]);
  assert.deepEqual(shown(alone), Object.fromEntries(listed.map((buyback) => [buyback.id, priceOf(buyback)])));
  assert.ok(alone.buybacks.filter((entry) => entry.kind === "upgrade").every((record) => destinationOf(record) === null));
});

import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { AUTH, CONTEXT, PRICE, SMALL, build, ccus, destinationOf, priceOf, shipImage, shown, sourceOf, upgradeCalls } from "./ccu-buyback-prices-loaded-with-fixture-build.mjs";

test("a build reads the price of each different CCU buy-back once, last, and shows it on every buy-back of that CCU", async () => {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const document = await build(harness, tab);
  const listed = ccus(harness.rsi);
  const different = new Set(listed.map((buyback) => `${buyback.upgrade.fromShipId}:${buyback.upgrade.toShipId}:${buyback.upgrade.toSkuId}`));
  assert.deepEqual([listed.length, different.size], [6, 2]);

  // One call to open the session. The hangar holds CCU pledges, so the whole list of ships is read once first: one
  // call that names no upgrade and one that asks the list. Then for each different CCU one call that names it and
  // one that asks its price; that request also asks for the ships of that CCU, so they cost no request of their own.
  assert.deepEqual(upgradeCalls(harness.rsi.requests), [1, 3, 3, 3]);
  const paths = harness.rsi.requests.map((request) => request.path);
  assert.ok(paths.indexOf(AUTH) > paths.findLastIndex((path) => /^\/pledge\/buyback\//u.test(path)), "CCU prices are read after the buy-back pages");
  assert.deepEqual(harness.rsi.requests.slice(paths.indexOf(AUTH)).map((request) => request.operations?.join("+") ?? request.path), [AUTH, CONTEXT, "ships", CONTEXT, "getPrice+ships", CONTEXT, "getPrice+ships"]);

  // Every CCU pledge of the hangar carries the image of the ship it starts from first, named as its title names
  // it, and keeps the image of the ship it leads to last. No other pledge is touched.
  const hangarCcus = document.pledges.filter((pledge) => pledge.category === "shipUpgrade");
  assert.ok(hangarCcus.length >= 2);
  for (const pledge of hangarCcus) {
    const from = /^Upgrade - (.+?) to /u.exec(pledge.title)[1];
    const [source, ...rest] = pledge.images;
    assert.deepEqual([source.role, source.altText, /\/upgrade-ship-9[0-9]{2}-large\.jpg$/u.test(source.url)], ["upgrade-source", from, true], pledge.title);
    assert.ok(rest.length >= 1 && rest.every((image) => image.role !== "upgrade-source"));
    assert.equal(rest.at(-1).imageKey, pledge.items.at(-1).images.at(-1).imageKey, "the image of the ship it leads to stays last");
  }
  assert.ok(document.pledges.filter((pledge) => pledge.category !== "shipUpgrade").every((pledge) => pledge.images.every((image) => !image.role.startsWith("upgrade-"))));
  assert.ok(harness.rsi.requests.filter((request) => [AUTH, CONTEXT, PRICE].includes(request.path)).every((request) => request.method === "POST" && request.tokenSent));

  // Every buy-back of a CCU shows the price read for it; nothing else about the buy-back list changed.
  assert.deepEqual(shown(document), Object.fromEntries(listed.map((buyback) => [buyback.id, priceOf(buyback)])));
  assert.equal(document.buybackUpgradePrices.length, 2);
  for (const entry of document.buybackUpgradePrices) {
    const read = listed.find((buyback) => buyback.id === entry.readFromBuybackId);
    assert.deepEqual([entry.recordKey, entry.fromShipId, entry.toShipId, entry.toSkuId, entry.price, entry.nativeAmount],
      [`buyback-upgrade-price:${read.upgrade.fromShipId}:${read.upgrade.toShipId}:${read.upgrade.toSkuId}`, Number(read.upgrade.fromShipId), Number(read.upgrade.toShipId), Number(read.upgrade.toSkuId), priceOf(read), Number(priceOf(read).amount) * 100]);
    // The buy-back whose number RSI was given is the first of its CCU in the list.
    assert.equal(read, listed.find((buyback) => buyback.upgrade.fromShipId === read.upgrade.fromShipId && buyback.upgrade.toShipId === read.upgrade.toShipId && buyback.upgrade.toSkuId === read.upgrade.toSkuId));
    // Both ships of the CCU are named, each with its image as RSI's store upgrade page lists it: the ship it starts
    // from, then the ship it leads to.
    assert.deepEqual([entry.fromShipName, entry.toShipName, entry.images.map((image) => [image.role, image.url, image.altText])], [`Synthetic Ship ${read.upgrade.fromShipId}`, `Synthetic Ship ${read.upgrade.toShipId}`, [
      ["upgrade-source", shipImage(read.upgrade.fromShipId), `Synthetic Ship ${read.upgrade.fromShipId}`],
      ["upgrade-destination", shipImage(read.upgrade.toShipId), `Synthetic Ship ${read.upgrade.toShipId}`]
    ]]);
  }
  // Every buy-back of a CCU carries both images first, before the image RSI gives every CCU buy-back alike.
  for (const record of document.buybacks.filter((entry) => entry.kind === "upgrade")) {
    const buyback = listed.find((entry) => entry.id === record.buybackId);
    assert.deepEqual([sourceOf(record), destinationOf(record), record.images.map((image) => image.role)], [shipImage(buyback.upgrade.fromShipId), shipImage(buyback.upgrade.toShipId), ["upgrade-source", "upgrade-destination", "thumbnail"]]);
  }
  assert.ok(document.buybacks.filter((entry) => entry.kind !== "upgrade").every((entry) => entry.images.every((image) => !image.role.startsWith("upgrade-"))));
  const outcome = document.sync.sectionOutcomes.buybackUpgradePrices;
  assert.deepEqual([outcome.status, outcome.records, outcome.warnings], ["complete", 2, []]);
  // A CCU buy-back has no page, and no page was asked for one.
  assert.ok(document.buybacks.filter((record) => record.kind === "upgrade").every((record) => !record.sourceLinks.some((link) => link.kind === "detail")));
});

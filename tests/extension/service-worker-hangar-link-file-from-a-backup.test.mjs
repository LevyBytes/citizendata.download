import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { buildBuybackDetail, upgradeCents } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a backup made by the extension writes a Hangar Link file with every pledge, ship, and buy-back in it", async () => {
  await import("../../docs/scripts/hangar-link-ships.js");
  await import("../../docs/scripts/compatibility-exports.js");
  const harness = await createExtensionHarness({ account: { counts: { pledges: 43, buybacks: 230 } } });
  const tab = harness.openTab();
  await tab.build();
  await harness.finishJob();
  const document = JSON.parse(JSON.stringify(resultOf(tab)));
  const { payload, recordCount, warnings } = globalThis.CitizenDataHangarLinkExport.prepareExport(document, { inventoryScope: "both" });
  assert.equal(recordCount, 43 + 230);
  assert.equal(payload.pledges.filter((record) => !record.buyback).length, 43);

  // The slug Hangar Link uses for each ship the synthetic account holds; the invented ship has none.
  const slugs = {
    "Aurora MR": "aurora-mr", "Mustang Alpha": "mustang-alpha", "Avenger Titan": "avenger-titan", "Cutlass Black": "cutlass-black", "Gladius": "gladius",
    "Freelancer": "freelancer", "Constellation Andromeda": "constellation-andromeda", "Carrack": "carrack", "Mustang Omega : AMD Edition": "mustang-omega",
    "Synthetic Prototype": ""
  };
  const written = new Map(payload.pledges.map((record) => [`${record.buyback}:${record.pledgeId}`, record]));
  const isoDate = (long) => new Date(`${long} UTC`).toISOString().slice(0, 10);
  const decimal = (value) => Number.isInteger(value) ? `${value}.0` : String(value);
  for (const [index, shown] of harness.rsi.state.pledges.entries()) {
    const record = written.get(`false:${shown.id}`);
    const ships = shown.items.filter((item) => item.kind === "Ship");
    const upgrade = /^Upgrade - (.+) to (.+) Standard Edition$/u.exec(shown.title);
    const upgradeSlugs = upgrade && slugs[upgrade[1]] && slugs[upgrade[2]] ? [slugs[upgrade[1]], slugs[upgrade[2]]] : ["", ""];
    const insurance = shown.alsoContains.find((title) => /Insurance$/u.test(title));
    const money = shown.alsoContains.find((title) => title.startsWith("Starting Money"));
    assert.deepEqual(record, {
      pledgeId: String(shown.id),
      name: shown.title.split(":")[0].replace(/[^A-Za-z\s0-9-]/gu, "").trim(),
      contains: shown.contains,
      cost: decimal(shown.valueCents / 100),
      configurationCost: decimal(shown.configurationCents / 100),
      currency: "USD",
      date: isoDate(shown.created),
      insuranceType: { "Lifetime Insurance": "insLTI", "120 Month Insurance": "ins120", "6 Month Insurance": "ins6", "3 Month Insurance": "ins3", "2 Month Insurance": "ins2" }[insurance] ?? "insNone",
      warbond: false,
      giftable: shown.giftable,
      meltable: shown.meltable,
      package: shown.alsoContains.includes("Star Citizen Digital Download"),
      uec: money ? decimal(Number(money.replace(/[^0-9]/gu, ""))) : "0.0",
      pledgeType: ships.length === 1 ? "ship" : upgrade ? "upgrade" : "other",
      hangar: "SyntheticCitizen",
      page: Math.floor(index / 10) + 1,
      pageOf: 10,
      alsoContains: shown.alsoContains.map((title) => ({ title })),
      items: shown.items.map((item) => ({ itemCustomName: item.customName ?? "", kind: item.kind ?? "", liner: item.liner ? `${item.liner.name} (${item.liner.code})` : "", title: item.title, slug: item.kind === "Ship" ? slugs[item.title] : "" })),
      upgradeFrom: upgradeSlugs[0],
      upgradeTo: upgradeSlugs[1],
      buyback: false,
      buybackHref: null,
      fromShipId: null,
      toShipId: null,
      toSkuId: null
    }, `pledge ${index}: ${shown.title}`);
  }
  for (const [index, shown] of harness.rsi.state.buybacks.entries()) {
    const record = written.get(`true:${shown.id}`);
    const upgrade = /^Upgrade - (.+) to (.+) Standard Edition$/u.exec(shown.title);
    const upgradeSlugs = upgrade && slugs[upgrade[1]] && slugs[upgrade[2]] ? [slugs[upgrade[1]], slugs[upgrade[2]]] : ["", ""];
    assert.deepEqual(record, {
      pledgeId: String(shown.id), name: shown.title.replace(/[^A-Za-z\s0-9-]/gu, "").trim(), contains: shown.contains, cost: decimal((shown.upgrade ? upgradeCents(shown) : buildBuybackDetail(shown).cents) / 100),
      configurationCost: "0.0", currency: "USD", date: isoDate(shown.date),
      insuranceType: "insNone", warbond: false, giftable: false, meltable: false, package: false, uec: "0.0",
      pledgeType: upgrade ? "upgrade" : "ship", hangar: "SyntheticCitizen", page: Math.floor(index / 100) + 1, pageOf: 100, alsoContains: [], items: [],
      upgradeFrom: upgradeSlugs[0], upgradeTo: upgradeSlugs[1], buyback: true,
      buybackHref: shown.upgrade ? "" : `/pledge/buyback/${shown.id}`,
      fromShipId: shown.upgrade?.fromShipId ?? "", toShipId: shown.upgrade?.toShipId ?? "", toSkuId: shown.upgrade?.toSkuId ?? ""
    }, `buy-back ${index}: ${shown.title}`);
  }
  // The account holds ships by every route the ship table offers, and one the table cannot know.
  const shipSlugs = new Set(payload.pledges.flatMap((record) => record.items.filter((item) => item.kind === "Ship").map((item) => item.slug)));
  assert.ok(shipSlugs.has("mustang-omega") && shipSlugs.has("aurora-mr") && shipSlugs.has(""));
  assert.ok(warnings.some((warning) => /^1 ship not in the Hangar Link ship table .*: Synthetic Prototype\.$/u.test(warning)), warnings.join(" | "));
  assert.ok(warnings.some((warning) => /upgrades? could not be matched/u.test(warning)));
  // Every CCU buy-back of this build has the price RSI asked, so none is written with a cost of 0.
  assert.ok(!warnings.some((warning) => /upgrade buy-backs? (?:is|are) written with a cost of 0/u.test(warning)), warnings.join(" | "));
  assert.ok(!warnings.some((warning) => /no buy-back prices|no recorded price/u.test(warning)), warnings.join(" | "));
  assert.ok(!warnings.some((warning) => /predates|Left out/u.test(warning)), warnings.join(" | "));
});

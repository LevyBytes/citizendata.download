import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { expectedPledge, recordedPledge } from "./service-worker-fixture-expected-and-recorded-pledge.mjs";
import { assertCompleteDocument, buildBuybackDetail, shownMoney, upgradeCents } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("the backup records each hangar pledge and buy-back as RSI shows it", async () => {
  const harness = await createExtensionHarness({ account: { counts: { pledges: 43, buybacks: 230 } } });
  const tab = harness.openTab();
  await tab.build();
  await harness.finishJob();
  const document = resultOf(tab);
  await assertCompleteDocument(document, harness.rsi);

  const pledges = new Map(document.pledges.map((record) => [record.pledgeId, record]));
  for (const [index, shown] of harness.rsi.state.pledges.entries()) {
    assert.deepEqual(recordedPledge(JSON.parse(JSON.stringify(pledges.get(shown.id)))), expectedPledge(shown, index), `pledge ${index}`);
  }
  // The account has ships with custom names, cards with and without a maker line, and both kinds of contents list.
  const items = document.pledges.flatMap((record) => record.items);
  assert.ok(items.some((item) => item.customName) && items.some((item) => item.manufacturer) && items.some((item) => item.section === "alsoContains"));
  assert.ok(document.pledges.some((record) => record.giftEligible) && document.pledges.some((record) => !record.giftEligible));
  assert.deepEqual([...new Set(document.pledges.map((record) => record.sourcePage))], [1, 2, 3, 4, 5]);

  const buybacks = new Map(document.buybacks.map((record) => [record.buybackId, record]));
  for (const [index, shown] of harness.rsi.state.buybacks.entries()) {
    const record = JSON.parse(JSON.stringify(buybacks.get(shown.id)));
    const identifier = (namespace, value) => [{ namespace, value, source: "rsi" }];
    assert.deepEqual({
      title: record.title, reclaimDateRaw: record.reclaimDateRaw, containsSummary: record.containsSummary, kind: record.kind, sourcePage: record.sourcePage, state: record.state,
      items: record.items, buybackPrice: record.buybackPrice, upgrade: record.upgrade, links: record.sourceLinks.map((link) => [link.kind, link.url])
    }, {
      title: `${shown.title}${shown.upgraded ? " - upgraded" : ""}`, reclaimDateRaw: shown.date, containsSummary: shown.contains, kind: shown.upgrade ? "upgrade" : "ordinary",
      // The list shows no price. An ordinary buy-back's price comes from its own page; an upgrade has no such page.
      sourcePage: Math.floor(index / 100) + 1, state: "available", items: [], buybackPrice: shownMoney(shown.upgrade ? upgradeCents(shown) : buildBuybackDetail(shown).cents),
      upgrade: shown.upgrade ? { fromShipIdentifiers: identifier("ship", shown.upgrade.fromShipId), toShipIdentifiers: identifier("ship", shown.upgrade.toShipId), skuIdentifiers: identifier("sku", shown.upgrade.toSkuId) } : null,
      // RSI links an ordinary buy-back to its own page; an upgrade is known only by the list page it was on.
      links: shown.upgrade
        ? [["listing", `https://robertsspaceindustries.com/account/buy-back-pledges?page=${Math.floor(index / 100) + 1}&pagesize=100`]]
        : [["detail", `https://robertsspaceindustries.com/pledge/buyback/${shown.id}`]]
    }, `buy-back ${index}`);
  }
  assert.ok(harness.rsi.state.buybacks.some((shown) => shown.upgraded) && harness.rsi.state.buybacks.some((shown) => shown.upgrade));
});

import assert from "node:assert/strict";
import test from "node:test";
import { Documents, Export, IMPORTED_AT, Import, OPTIONS, Removals, SHIPS, boughtBack, opened, record, schema } from "./hangar-link-import-loaded-with-fixture-records.mjs";

test("a file CitizenData wrote for Hangar Link opens to the same file when written again", async () => {
  const observedAt = "2026-11-01T00:00:00.000Z";
  const observation = { firstObservedAt: observedAt, lastObservedAt: observedAt, parserVersion: "1.1.0" };
  const item = (name, fields = {}) => ({ recordKey: `item:${name}`, name, kind: null, manufacturer: null, customName: null, section: "items", category: "other", quantity: 1, images: [], catalogIdentifiers: [], ...fields });
  const source = {
    account: { handle: "ExampleCitizen" },
    pledges: [
      {
        pledgeId: 41000101, recordKey: "pledge:41000101", title: "Standalone Ships - Aegis Gladius - LTI", category: "standaloneShip", availability: "Attributed", createdDateRaw: "May 09, 2026",
        containsSummary: "Gladius and 2 items",
        items: [item("Gladius", { kind: "Ship", manufacturer: "Aegis Dynamics (AEGS)", customName: "Night Owl" }), item("Example Poster", { kind: "Hangar decoration", quantity: 2 }), item("Lifetime Insurance", { section: "alsoContains" })],
        images: [], sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/account/pledges?page=4&product-type=", observedAt }], sourcePage: 4,
        state: "current", observation, meltValue: { amount: "90.00", currency: "USD" }, meltEligible: true, giftEligible: true, baseValue: { amount: "17.25", currency: "USD" }, ccuHistory: [], catalogIdentifiers: []
      },
      {
        pledgeId: 41000102, recordKey: "pledge:41000102", title: "Package - Example Starter", category: "gamePackage", availability: "Attributed", createdDateRaw: "September 2, 2014",
        containsSummary: "Aurora Mk I MR and 3 items",
        items: [item("Aurora Mk I MR", { kind: "Ship", manufacturer: "Roberts Space Industries (RSI)" }), item("Star Citizen Digital Download", { section: "alsoContains" }), item("Starting Money: 1,000 UEC", { section: "alsoContains" })],
        images: [], sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/account/pledges?page=1&product-type=", observedAt }], sourcePage: 1,
        state: "current", observation, meltValue: { amount: "45.00", currency: "USD" }, meltEligible: false, giftEligible: false, baseValue: { amount: "0.00", currency: "USD" }, ccuHistory: [], catalogIdentifiers: []
      }
    ],
    buybacks: [
      {
        buybackId: 21000101, recordKey: "buyback:21000101", kind: "ordinary", category: "other", title: "Add-Ons - Example Flair", reclaimDateRaw: "March 3, 2025", containsSummary: "Example Flair", availability: "Available",
        items: [], images: [], sourceLinks: [{ kind: "detail", url: "https://robertsspaceindustries.com/pledge/buyback/21000101", observedAt }], sourcePage: 2,
        state: "available", observation, buybackPrice: { amount: "12.50", currency: "USD" }, catalogIdentifiers: [], upgrade: null
      },
      {
        buybackId: 21000102, recordKey: "buyback:21000102", kind: "upgrade", category: "shipUpgrade", title: "Ship Upgrades - Aurora MR to Gladius Upgrade",
        reclaimDateRaw: "March 4, 2025", containsSummary: "Aurora MR to Gladius Upgrade", availability: "Available",
        items: [], images: [], sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/account/buy-back-pledges?page=1&pagesize=100", observedAt }], sourcePage: 1,
        state: "available", observation, buybackPrice: null, catalogIdentifiers: [],
        upgrade: { fromShipIdentifiers: [{ namespace: "ship", value: "101", source: "rsi" }], toShipIdentifiers: [{ namespace: "ship", value: "202", source: "rsi" }], skuIdentifiers: [{ namespace: "sku", value: "303", source: "rsi" }] }
      }
    ]
  };
  const first = Export.prepareExport(source, { inventoryScope: "both", ships: SHIPS }).payload;
  assert.equal(first.pledges.length, 4);
  const { document, counts } = Import.toAccountDocument(JSON.parse(JSON.stringify(first)), OPTIONS);
  assert.deepEqual(counts, { hangar: 2, buybacks: 2, repeated: 0, leftOut: 0 });
  await Documents.acceptAccountDocument(await Documents.stampIntegrity(document), schema);
  assert.deepEqual(Export.prepareExport(document, { inventoryScope: "both", ships: SHIPS }).payload, first);
});

test("an opened Hangar Link file can never be the earlier backup a removal is claimed from", () => {
  const previous = opened(record(), record({ pledgeId: "41000002" }), boughtBack(), boughtBack({ pledgeId: "21000009", buybackHref: "/pledge/buyback/21000009" })).document;
  const complete = { status: "complete", parserVersion: "1.1.0", startedAt: IMPORTED_AT, endedAt: IMPORTED_AT, records: 0, pagesOrBatches: 1, warnings: [] };
  // The new build lists one pledge and one buy-back fewer, and its Hangar Log names neither.
  const document = {
    exportedAt: "2026-11-20T12:00:00.000Z",
    pledges: [structuredClone(previous.pledges[0])],
    buybacks: [structuredClone(previous.buybacks[0])],
    hangarLog: [{ rawTimestamp: "Nov 19 2026, 4:10 pm", subjectId: 999, subjectName: "Something else", kind: "created", rawDetail: "Created by Citizen" }],
    sync: { sectionOutcomes: { pledges: complete, buybacks: complete, hangarLog: complete } }
  };
  const results = ["pledges", "buybacks", "hangarLog"].map((section) => ({ section, outcome: complete }));
  const tracking = Removals.reconcile({ document, previous, previousVerified: true, results, reusedSections: [], comparedAt: document.exportedAt });
  const notCompared = { status: "not-compared", reason: "earlier-hangar-log-incomplete", missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept: 0 };
  assert.deepEqual([tracking.pledges, tracking.buybacks], [notCompared, notCompared]);
  assert.deepEqual([document.pledges.length, document.buybacks.length], [1, 1]);
  assert.equal([...document.pledges, ...document.buybacks].some((entry) => entry.state === Removals.KEPT_STATE || entry.removal), false);
});

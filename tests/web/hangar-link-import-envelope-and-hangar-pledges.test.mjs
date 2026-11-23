import assert from "node:assert/strict";
import test from "node:test";
import { Documents, IMPORTED_AT, Import, OPTIONS, boughtBack, file, opened, record, schema, upgradeBuyback } from "./hangar-link-import-loaded-with-fixture-records.mjs";

test("only the Hangar Link envelope is recognised", () => {
  assert.equal(Import.isHangarLinkFile(file(record())), true);
  assert.equal(Import.isHangarLinkFile({ type: "hangarlink", version: 1 }), false);
  assert.equal(Import.isHangarLinkFile({ type: "other", version: 1, pledges: [] }), false);
  assert.equal(Import.isHangarLinkFile([record()]), false);
  assert.equal(Import.isHangarLinkFile(null), false);
  // A CitizenData account file also has a list called pledges; it is not a Hangar Link file.
  assert.equal(Import.isHangarLinkFile({ schemaVersion: 1, generator: { name: "CitizenData", version: "0.42.2" }, pledges: [] }), false);
});

test("the opened file is a valid account document that says it is an incomplete build", async () => {
  const { document, counts } = opened(record(), boughtBack(), upgradeBuyback());
  assert.deepEqual(counts, { hangar: 1, buybacks: 2, repeated: 0, leftOut: 0 });
  const stamped = await Documents.stampIntegrity(document);
  await Documents.acceptAccountDocument(stamped, schema);
  globalThis.CitizenDataDashboardModel.validateAccountDocument(stamped);

  assert.deepEqual(document.generator, { name: "Hangar Link import", version: "0.42.2" });
  assert.equal(Import.isHangarLinkImport(document), true);
  assert.equal(Import.isHangarLinkImport({ generator: { name: "CitizenData", version: "0.42.2" } }), false);
  assert.deepEqual(document.account, { localAccountId: OPTIONS.localAccountId, ueeCitizenRecord: null, handle: "ExampleCitizen" });

  // The two lists are partial. Every other section was not run, the Hangar Log included, and holds nothing.
  const statuses = Object.fromEntries(Object.entries(document.sync.sectionOutcomes).map(([section, outcome]) => [section, outcome.status]));
  assert.equal(Object.keys(statuses).length, 16);
  assert.deepEqual(Object.entries(statuses).filter(([, status]) => status !== "notRun"), [["pledges", "partial"], ["buybacks", "partial"]]);
  assert.equal(Object.values(statuses).includes("complete"), false);
  assert.deepEqual(
    document.sync.sectionOutcomes.pledges,
    { status: "partial", parserVersion: "hangar-link-import-1", startedAt: IMPORTED_AT, endedAt: IMPORTED_AT, records: 1, pagesOrBatches: 0, warnings: ["Imported from a Hangar Link file. Star Citizen Data Downloader did not read this list from RSI."] }
  );
  assert.deepEqual(document.sync.sectionOutcomes.hangarLog, { status: "notRun", parserVersion: null, startedAt: null, endedAt: null, records: 0, pagesOrBatches: 0, warnings: [] });
  assert.deepEqual(document.hangarLog, []);
  assert.deepEqual(document.financial, { balances: { storeCredit: null, uec: null, rec: null }, billingTotal: null, creditLedgers: { storeCredit: [], uec: [], rec: [] }, subscriptions: [], orders: [] });
  assert.deepEqual(document.referrals, { current: { prospects: [], recruits: [] }, legacy: { prospects: [], recruits: [] } });
  assert.deepEqual(document.organizations, { memberships: [] });
  assert.deepEqual(document.sync.runs, []);
});

test("a hangar pledge carries what the file states and nothing else", () => {
  const [pledge] = opened(record()).document.pledges;
  assert.deepEqual(pledge, {
    pledgeId: 41000001,
    recordKey: "pledge:41000001",
    title: "Standalone Ships - Aegis Gladius",
    category: "standaloneShip",
    availability: null,
    createdDateRaw: "August 25, 2016",
    containsSummary: "Gladius and 2 items",
    items: [
      { recordKey: "pledge:41000001:item:0", name: "Gladius", kind: "Ship", manufacturer: "Aegis Dynamics (AEGS)", customName: "Night Owl", section: "items", category: "other", quantity: 1, images: [], catalogIdentifiers: [] },
      { recordKey: "pledge:41000001:item:1", name: "Lifetime Insurance", kind: null, manufacturer: null, customName: null, section: "alsoContains", category: "other", quantity: 1, images: [], catalogIdentifiers: [] }
    ],
    images: [],
    sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/account/pledges?page=2&pagesize=10", observedAt: IMPORTED_AT }],
    sourcePage: 2,
    state: "current",
    observation: { firstObservedAt: IMPORTED_AT, lastObservedAt: IMPORTED_AT, parserVersion: "hangar-link-import-1" },
    meltValue: { amount: "90.00", currency: "USD" },
    meltEligible: true,
    giftEligible: true,
    baseValue: { amount: "0.00", currency: "USD" },
    ccuHistory: [],
    catalogIdentifiers: []
  });
});

test("a value the file cannot state is left empty", () => {
  // Hangar Link writes a cost of 0 for a pledge valued in game credits.
  const [credits] = opened(record({ cost: "0.0", currency: "UEC" })).document.pledges;
  assert.equal(credits.meltValue, null);
  assert.equal(credits.baseValue, null);
  // A cost that is not a plain amount, and a page counted at another page size, are not carried over.
  const [odd] = opened(record({ cost: "about 90", pageOf: 25 })).document.pledges;
  assert.equal(odd.meltValue, null);
  assert.equal(odd.sourcePage, null);
  assert.deepEqual(odd.sourceLinks.map((link) => link.url), ["https://robertsspaceindustries.com/account/pledges"]);
  // A buy-back cost of 0 does not say whether the buy-back is free or unpriced.
  assert.equal(opened(boughtBack({ cost: "0.0" })).document.buybacks[0].buybackPrice, null);
});

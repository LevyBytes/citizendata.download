import assert from "node:assert/strict";
import test from "node:test";
import { Model } from "./dashboard-scripts-under-test.mjs";

test("inventory search indexes nested record fields before pagination", () => {
  const record = {
    recordKey: "pledge-42",
    title: "Explorer Pack",
    category: "gamePackage",
    createdDateRaw: "November 18, 2026",
    items: [{ name: "Carrack Expedition", type: "Ship" }],
    sourceLinks: [{ url: "https://robertsspaceindustries.com/account/pledges" }]
  };
  const index = Model.inventorySearchText(record);
  for (const expected of ["pledge-42", "explorer pack", "gamepackage", "november 18, 2026", "carrack expedition", "ship", "robertsspaceindustries.com"]) {
    assert.equal(index.includes(expected), true, expected);
  }
});

test("inventory media entries include contained items and deduplicate shared images", () => {
  const shared = { imageKey: "shared", role: "thumbnail", altText: "Shared image" };
  const record = {
    title: "Explorer Pack",
    images: [shared, { imageKey: "record", role: "hero", altText: "Package image" }],
    items: [{ name: "Carrack", images: [shared, { imageKey: "ship", role: "thumbnail", altText: "Carrack image" }] }]
  };
  const entries = Model.inventoryMediaEntries(record);
  assert.deepEqual(entries.map((entry) => entry.reference.imageKey), ["shared", "record", "ship"]);
  assert.deepEqual(entries.map((entry) => entry.label), ["Shared image", "Package image", "Carrack image"]);
});

test("a CCU is shown by the image of the ship it leads to; any other record by its first image", () => {
  const placeholder = { imageKey: "placeholder", role: "thumbnail" };
  const ship = { imageKey: "ship", role: "thumbnail" };
  // A hangar CCU: RSI's picture of the pledge first, then the image of the item it holds, the ship it leads to.
  const hangarCcu = { category: "shipUpgrade", title: "Upgrade - A to B", images: [placeholder, ship], items: [{ name: "B", images: [ship] }] };
  assert.equal(Model.inventoryLeadMediaIndex(hangarCcu), 1);
  // A CCU buy-back: the ship it starts from, the ship it leads to, then RSI's picture.
  const buybackCcu = { kind: "upgrade", category: "shipUpgrade", images: [{ imageKey: "from", role: "upgrade-source" }, { imageKey: "to", role: "upgrade-destination" }, placeholder], items: [] };
  assert.equal(Model.inventoryLeadMediaIndex(buybackCcu), 1);
  // A CCU buy-back no ship image was read for is shown by the one image it has.
  assert.equal(Model.inventoryLeadMediaIndex({ kind: "upgrade", images: [placeholder], items: [] }), 0);
  // Anything else is shown by its first image, and a record without images has no lead.
  assert.equal(Model.inventoryLeadMediaIndex({ category: "ship", kind: "ordinary", images: [ship, placeholder], items: [{ name: "B", images: [{ imageKey: "other", role: "thumbnail" }] }] }), 0);
  assert.equal(Model.inventoryLeadMediaIndex({ category: "shipUpgrade", images: [], items: [] }), 0);
});

test("referral search indexes moniker and username together", () => {
  const index = Model.referralSearchText({ displayName: "Director Gunner", handle: "DirectorGunner", dateRaw: "November 18, 2026" });
  assert.equal(index.includes("director gunner"), true);
  assert.equal(index.includes("directorgunner"), true);
  assert.equal(index.includes("november"), false);
});

test("RSI's placeholder picture in a saved file is not an entry of a record's gallery", () => {
  const placeholder = { imageKey: "placeholder", role: "thumbnail", url: "https://cdn.robertsspaceindustries.com/static/images/Temp/default-image.png" };
  const from = { imageKey: "from", role: "upgrade-source", url: "https://media.robertsspaceindustries.com/a/store_small/from.jpg" };
  const to = { imageKey: "to", role: "thumbnail", url: "https://media.robertsspaceindustries.com/b/store_small/to.jpg" };
  const hangarCcu = { category: "shipUpgrade", title: "Upgrade - A to B", images: [from, placeholder, to], items: [] };
  assert.deepEqual(Model.inventoryMediaEntries(hangarCcu).map((entry) => entry.reference.imageKey), ["from", "to"]);
  assert.equal(Model.inventoryLeadMediaIndex(hangarCcu), 1);
  assert.deepEqual(Model.inventoryMediaEntries({ kind: "upgrade", images: [placeholder], items: [] }), []);
});

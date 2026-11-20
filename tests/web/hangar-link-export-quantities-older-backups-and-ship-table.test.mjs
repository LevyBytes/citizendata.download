import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Export, also, backup, buyback, deepFreeze, hangarRecord, item, observedAt, pledge, ship, shippedTable, written } from "./hangar-link-export-loaded-with-fixture-builders.mjs";

test("an item with a quantity is written that many times", () => {
  const record = hangarRecord({ items: [ship("Gladius", { quantity: 3 }), also("Lifetime Insurance"), item("Example Flair", { quantity: 2, section: "alsoContains" })] });
  assert.deepEqual(record.items.map((entry) => entry.slug), ["gladius", "gladius", "gladius"]);
  assert.deepEqual(record.alsoContains, [{ title: "Lifetime Insurance" }, { title: "Example Flair" }, { title: "Example Flair" }]);
  assert.equal(record.pledgeType, "pack");
});

test("a backup made before the newer fields were recorded still exports, and says what it lacks", () => {
  // Such a backup holds one item list, a ship's custom name inside its item name, no gift flag, and no page number.
  const older = pledge({
    title: "Package - Aurora MR Starter Pack",
    sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/en/account/pledges?page=12&product-type=", observedAt }],
    items: [
      { recordKey: "a", name: "Aurora MR - Night Owl", kind: "Ship", category: "standaloneShip", quantity: 1, images: [], catalogIdentifiers: [] },
      { recordKey: "b", name: "Star Citizen Digital Download", kind: null, category: "other", quantity: 1, images: [], catalogIdentifiers: [] },
      { recordKey: "c", name: "Lifetime Insurance", kind: null, category: "other", quantity: 1, images: [], catalogIdentifiers: [] },
      { recordKey: "d", name: "Kastak Arms - Custodian SMG", kind: "FPS Equipment", category: "weapon", quantity: 1, images: [], catalogIdentifiers: [] }
    ]
  });
  delete older.giftEligible;
  delete older.sourcePage;
  const olderBuyback = buyback({ buybackId: 21000777, sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/account/buy-back-pledges?page=3&pagesize=100", observedAt }] });
  delete olderBuyback.sourcePage;
  const result = written(backup([older], [olderBuyback]));
  const [record, bought] = result.payload.pledges;
  assert.deepEqual(record.items, [
    { itemCustomName: "Night Owl", kind: "Ship", liner: "", title: "Aurora MR", slug: "aurora-mr" },
    { itemCustomName: "", kind: "", liner: "", title: "Star Citizen Digital Download", slug: "" },
    { itemCustomName: "", kind: "", liner: "", title: "Lifetime Insurance", slug: "" },
    // Only a ship's name is split at its last hyphen.
    { itemCustomName: "", kind: "FPS Equipment", liner: "", title: "Kastak Arms - Custodian SMG", slug: "" }
  ]);
  assert.deepEqual(record.alsoContains, []);
  assert.deepEqual([record.insuranceType, record.package, record.pledgeType, record.giftable, record.page], ["insLTI", true, "ship", false, 12]);
  assert.deepEqual([bought.page, bought.buybackHref], [3, "/pledge/buyback/21000777"]);
  assert.ok(result.warnings.includes("This backup predates gift, also-contains, maker, and custom-name capture. Update it with the extension to add them."));
  // A current backup carries no such note.
  assert.ok(!written(backup([pledge()])).warnings.some((warning) => /predates/u.test(warning)));
});

test("writing the export changes nothing in the backup", () => {
  const document = deepFreeze(backup([pledge({ items: [ship("Gladius", { customName: "Example" }), also("Lifetime Insurance")] })], [buyback()]));
  const before = JSON.stringify(document);
  const first = written(document);
  assert.equal(JSON.stringify(document), before);
  // The same backup always writes the same file.
  assert.deepEqual(written(document), first);
});

test("the shipped ship table is consistent and knows well-known ships", async () => {
  const slugs = new Set(shippedTable.slugs);
  assert.equal(slugs.size, shippedTable.slugs.length, "a slug is listed twice");
  assert.ok(shippedTable.slugs.length >= 300);
  assert.ok(shippedTable.slugs.every((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)));
  assert.deepEqual([...shippedTable.slugs].sort(), shippedTable.slugs, "slugs are sorted");
  for (const [title, slug] of Object.entries(shippedTable.titles)) {
    assert.equal(title, title.toLowerCase().trim());
    assert.ok(slugs.has(slug), `${title} names an unknown ship`);
  }
  for (const [spelling, slug] of Object.entries(shippedTable.aliases)) {
    assert.match(spelling, /^[a-z0-9-]+$/u);
    assert.ok(slugs.has(slug), `${spelling} names an unknown ship`);
    assert.ok(!slugs.has(spelling), `${spelling} is itself a slug, so its alias never applies`);
  }
  for (const [title, slug] of [
    ["Aurora MR", "aurora-mr"], ["Aurora Mk I MR", "aurora-mr"], ["Mustang Omega : AMD Edition", "mustang-omega"], ["MPUV Cargo", "mpuv-cargo"], ["Carrack", "carrack"],
    ["Constellation Mk IV Andromeda", "constellation-andromeda"]
  ]) {
    assert.equal(Export.locateShip(title), slug, title);
  }
  // The table was rebuilt after the last change to the alias file.
  const aliasFile = JSON.parse(await readFile(new URL("../../scripts/hangar-link-title-aliases.json", import.meta.url), "utf8"));
  assert.deepEqual(shippedTable.aliases, aliasFile.aliases, "run scripts/build-hangar-link-ships.mjs after editing the alias file");
  // Without a table there is no export, and the reason is given.
  assert.throws(() => Export.prepareExport(backup([pledge()]), { ships: {} }), /ship table did not load/u);
});

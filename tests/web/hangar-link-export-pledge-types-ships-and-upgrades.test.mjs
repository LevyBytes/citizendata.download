import assert from "node:assert/strict";
import test from "node:test";
import { Export, SHIPS, backup, buyback, buybackRecord, hangarRecord, item, pledge, ship, written } from "./hangar-link-export-loaded-with-fixture-builders.mjs";

test("pledge type follows the name, and the ships a pledge holds override it", () => {
  const type = (title, items = []) => hangarRecord({ title, items }).pledgeType;
  assert.equal(type("Ship Upgrades - Aurora MR to Gladius Upgrade"), "upgrade");
  assert.equal(type("Upgrade - Aurora MR to Gladius Standard Edition"), "upgrade");
  assert.equal(type("Add-Ons - Ballistic Upgrade Kit"), "other");
  assert.equal(type("Paints - Gladius Livery Upgrade"), "other");
  assert.equal(type("F7C-M Mk II Heartseeker Upgrade"), "other");
  assert.equal(type("Package - Example Starter Pack"), "ship");
  assert.equal(type("Standalone Ships - Example"), "ship");
  assert.equal(type("Add-Ons - Example Flair"), "other");
  assert.equal(type("Add-Ons - Example Flair", [ship("Gladius")]), "ship");
  assert.equal(type("Add-Ons - Example Flair", [ship("Gladius"), ship("Aurora MR")]), "pack");
  assert.equal(type("Package - Example Starter Pack", [ship("Gladius"), ship("Aurora MR"), ship("Avenger Titan")]), "pack");
  // A buy-back lists no contents, so only its name decides.
  assert.equal(buybackRecord({ title: "Standalone Ships - Gladius" }).pledgeType, "ship");
  assert.equal(buybackRecord({ title: "Add-Ons - Example Flair" }).pledgeType, "other");
});

test("a ship is named by its Hangar Link slug so Fleetview can draw it", () => {
  const slug = (title) => Export.locateShip(title, SHIPS);
  assert.equal(slug("Avenger Titan"), "avenger-titan");
  assert.equal(slug("  avenger titan "), "avenger-titan");
  // A title the catalogue lists for a ship.
  assert.equal(slug("Aurora Mk I MR"), "aurora-mr");
  // A maker name in front of the ship is dropped.
  assert.equal(slug("RSI Aurora MR"), "aurora-mr");
  assert.equal(slug("Aegis Gladius"), "gladius");
  // A spelling RSI sells under, by way of the alias list.
  assert.equal(slug("Mustang Omega : AMD Edition"), "mustang-omega");
  // Dropping maker names also shortens "Cargo"; the alias list allows for it.
  assert.equal(slug("MPUV Cargo"), "mpuv-cargo");
  assert.equal(slug("Synthetic Prototype"), null);
  assert.equal(slug(""), null);
  assert.equal(slug(null), null);

  const result = written(backup([pledge({ items: [
    ship("Mustang Omega : AMD Edition"),
    ship("Synthetic Prototype"),
    // Only an item RSI labels a ship gets a slug, whatever its title says.
    item("Gladius", { kind: "Skin" })
  ] })]));
  assert.deepEqual(result.payload.pledges[0].items.map((entry) => entry.slug), ["mustang-omega", "", ""]);
  // The unknown ship stays in the file; the user is told Fleetview will not draw it.
  assert.deepEqual(result.warnings, ["1 ship not in the Hangar Link ship table will be listed without a Fleetview model: Synthetic Prototype."]);

  const many = written(backup([pledge({ items: ["G", "B", "A", "F", "C", "E", "D", "A"].map((letter) => ship(`Prototype ${letter}`)) })]));
  assert.deepEqual(many.warnings, ["7 ships not in the Hangar Link ship table will be listed without a Fleetview model: Prototype A, Prototype B, Prototype C, Prototype D, Prototype E, and 2 more."]);
});

test("the Super Hornet Mk II is the Heartseeker when the pledge says so", () => {
  const plain = hangarRecord({ items: [ship("F7C-M Super Hornet Mk II")] });
  assert.equal(plain.items[0].slug, "f7c-m-super-hornet-mk-ii");
  const heartseeker = hangarRecord({ items: [ship("F7C-M Super Hornet Mk II"), item("F7C-M Hornet Mk II Heartseeker Paint", { kind: "Skin" })] });
  assert.equal(heartseeker.items[0].slug, "f7cm-hornet-heartseeker-mkii");
});

test("an upgrade names the two ships it joins, or neither", () => {
  const ends = (fields) => { const record = hangarRecord(fields); return [record.pledgeType, record.upgradeFrom, record.upgradeTo]; };
  assert.deepEqual(ends({ title: "Ship Upgrades - Aurora MR to Gladius Upgrade", containsSummary: "Aurora MR to Gladius Upgrade" }), ["upgrade", "aurora-mr", "gladius"]);
  assert.deepEqual(ends({ title: "Upgrade - Aurora MR to Avenger Titan Standard Edition", containsSummary: "Aurora MR to Avenger Titan Standard Edition" }), ["upgrade", "aurora-mr", "avenger-titan"]);
  assert.deepEqual(ends({ title: "Ship Upgrades - Gladius to MPUV Cargo Warbond Upgrade", containsSummary: "1 item" }), ["upgrade", "gladius", "mpuv-cargo"]);
  // The summary and the name say nothing usable; the one unnamed card does.
  assert.deepEqual(ends({ title: "Ship Upgrades", containsSummary: "Upgrade", items: [item("Aurora MR to Gladius Upgrade")] }), ["upgrade", "aurora-mr", "gladius"]);
  // Not an upgrade by name: no ships are read out of its text.
  assert.deepEqual(ends({ title: "Add-Ons - Example Flair", containsSummary: "Aurora MR to Gladius" }), ["other", "", ""]);

  const unknown = written(backup([
    pledge({ title: "Upgrade - Aurora MR to Synthetic Prototype Standard Edition", containsSummary: "Aurora MR to Synthetic Prototype Upgrade" }),
    pledge({ title: "Upgrade - Gladius Standard Edition", containsSummary: "Gladius Upgrade" })
  ], [
    buyback({ title: "Upgrade - Aurora MR to Gladius Standard Edition", containsSummary: "Aurora MR to Gladius Upgrade" }),
    buyback({ title: "Upgrade - Synthetic Prototype to Gladius Standard Edition", containsSummary: "Synthetic Prototype to Gladius Upgrade" })
  ]));
  assert.deepEqual(unknown.payload.pledges.map((record) => [record.pledgeType, record.upgradeFrom, record.upgradeTo]), [["upgrade", "", ""], ["upgrade", "", ""], ["upgrade", "aurora-mr", "gladius"], ["upgrade", "", ""]]);
  assert.ok(unknown.warnings.includes("3 upgrades could not be matched to two known ships and are written without them."));
});

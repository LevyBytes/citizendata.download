import assert from "node:assert/strict";
import test from "node:test";
import { Export, also, backup, buybackRecord, hangarRecord, item, pledge, written } from "./hangar-link-export-loaded-with-fixture-builders.mjs";

test("names keep only letters, digits, spaces, and hyphens, and drop a coupon code", () => {
  assert.equal(hangarRecord({ title: "Add-Ons - \"Dominion\" Rifle (2950) & Kit" }).name, "Add-Ons - Dominion Rifle 2950  Kit");
  assert.equal(hangarRecord({ title: "Standalone Ships - Gladius : COUPON-1234" }).name, "Standalone Ships - Gladius");
  // RSI marks a buy-back that had an upgrade applied; the mark is not part of the name.
  assert.equal(buybackRecord({ title: "Standalone Ships - Gladius - upgraded" }).name, "Standalone Ships - Gladius");
});

test("amounts are written the way Hangar Link writes numbers, and only dollar values count", () => {
  const cost = (amount, currency = "USD") => hangarRecord({ meltValue: { amount, currency } }).cost;
  assert.equal(cost("100.00"), "100.0");
  assert.equal(cost("12.50"), "12.5");
  assert.equal(cost("17.25"), "17.25");
  assert.equal(cost("0.00"), "0.0");
  assert.equal(cost("1250.00"), "1250.0");
  // Hangar Link reads no value for a pledge RSI prices in game credits.
  const credits = hangarRecord({ meltValue: { amount: "5000.00", currency: "UEC" } });
  assert.equal(credits.cost, "0.0");
  assert.equal(credits.currency, "UEC");
  assert.equal(hangarRecord({ baseValue: { amount: "30.00", currency: "USD" } }).configurationCost, "30.0");

  const unknown = written(backup([pledge({ meltValue: null, baseValue: null }), pledge()]));
  assert.equal(unknown.payload.pledges[0].cost, "0.0");
  assert.equal(unknown.payload.pledges[0].configurationCost, "0.0");
  assert.equal(unknown.payload.pledges[0].currency, "USD");
  assert.deepEqual(unknown.warnings, ["1 pledge with no recorded value is written with a cost of 0."]);
});

test("RSI's dates become calendar dates, in either month spelling", () => {
  assert.equal(Export.isoDate("May 09, 2026"), "2026-05-09");
  assert.equal(Export.isoDate("September 2, 2014"), "2014-09-02");
  assert.equal(Export.isoDate("Sep 02, 2014"), "2014-09-02");
  assert.equal(Export.isoDate("  February 29, 2024 "), "2024-02-29");
  for (const unreadable of ["February 30, 2024", "Smarch 3, 2024", "2026-05-09", "May 2026", "", null, undefined]) assert.equal(Export.isoDate(unreadable), null, String(unreadable));
  assert.equal(hangarRecord({ createdDateRaw: "October 22, 2013" }).date, "2013-10-22");
  assert.equal(buybackRecord({ reclaimDateRaw: "Mar 03, 2025" }).date, "2025-03-03");
});

test("insurance is the longest cover a pledge lists, wherever it is listed", () => {
  const insurance = (...items) => hangarRecord({ items }).insuranceType;
  assert.equal(insurance(), "insNone");
  assert.equal(insurance(also("Lifetime Insurance")), "insLTI");
  assert.equal(insurance(also("120 Month Insurance"), also("Lifetime Insurance"), also("3 Month Insurance")), "insLTI");
  assert.equal(insurance(also("3 Month Insurance"), also("120 Month Insurance")), "ins120");
  // RSI writes both "6 Month" and "6 Months".
  assert.equal(insurance(also("6 Months Insurance")), "ins6");
  // Insurance can be a card with a picture as well as a line under "Also Contains".
  assert.equal(insurance(item("2 Month Insurance", { kind: "Insurance" })), "ins2");
  for (const [title, expected] of [["72 Month Insurance", "ins72"], ["60 Month Insurance", "ins60"], ["24 Month Insurance", "ins24"], ["12 Month Insurance", "ins12"], ["3 Month Insurance", "ins3"]]) assert.equal(insurance(also(title)), expected);
  // A cover length Hangar Link has no name for is not guessed at.
  assert.equal(insurance(also("36 Month Insurance")), "insNone");
});

test("package and starting UEC come from the listed contents", () => {
  assert.equal(hangarRecord({ items: [also("Star Citizen Digital Download")] }).package, true);
  assert.equal(hangarRecord({ items: [item("Star Citizen Digital Download", { kind: "Digital access" })] }).package, true);
  assert.equal(hangarRecord({ items: [also("Squadron 42 Digital Download")] }).package, false);
  assert.equal(hangarRecord({ items: [also("Starting Money: 5,000 UEC")] }).uec, "5000.0");
  assert.equal(hangarRecord({ items: [item("Starting Money: 1,000 UEC", { kind: "Credits" })] }).uec, "1000.0");
  assert.equal(hangarRecord({ items: [item("Starting Money: 1,000 UEC", { kind: "Credits" }), also("Starting Money: 20,000 UEC")] }).uec, "20000.0");
  assert.equal(hangarRecord({ items: [also("10,000 UEC")] }).uec, "0.0");
  assert.equal(hangarRecord().uec, "0.0");
});

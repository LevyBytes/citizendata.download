import assert from "node:assert/strict";
import test from "node:test";
import { changedValues, declaredProperties, differingElements, isGridTrack, propertiesToRead } from "./rendering/check-rendering/declared-properties-and-reading-comparison.mjs";

const reading = (names, tags, full, loose = full) => ({ names, tags, full, loose });

test("declared properties: names after { or ;, comments left out, custom properties keep their case", () => {
  const css = "/* color: red; */ .a { Margin-Top: 0; --Accent: #fff } @media (width > 1px) { .b { -webkit-line-clamp: 2; grid-template-columns: 1fr; } }";
  assert.deepEqual([...declaredProperties(css)].sort(), ["--Accent", "-webkit-line-clamp", "grid-template-columns", "margin-top"]);
  assert.deepEqual([...declaredProperties("")], []);
});

test("properties to read: those always read and those declared, once each and sorted", () => {
  const properties = propertiesToRead([".a { color: red; gap: 1px; }", ".a { gap: 2px; accent-color: red; }"]);
  assert.ok(properties.includes("display") && properties.includes("gap") && properties.includes("accent-color"));
  assert.equal(properties.filter((name) => name === "color").length, 1);
  assert.deepEqual(properties, [...properties].sort());
});

test("grid tracks are the grid-template properties and the grid shorthand", () => {
  assert.deepEqual(["grid", "grid-template", "grid-template-columns", "grid-template-rows", "grid-gap", "grid-column", "gap"].map(isGridTrack), [true, true, true, true, false, false, false]);
});

test("differing elements: the same readings differ nowhere; a changed reading is found by its place", () => {
  const before = reading(["#a", ".b", "p"], ["DIV", "DIV", "P"], ["1", "2", "3"]);
  assert.deepEqual(differingElements(before, before), { structure: null, differing: [], retagged: 0 });
  assert.deepEqual(differingElements(before, reading(before.names, before.tags, ["1", "x", "3"])).differing, [1]);
});

test("differing elements: a new tag is compared by the reading without grid tracks", () => {
  const before = reading(["#grid"], ["DIV"], ["tracks-as-sized"], ["same"]);
  assert.deepEqual(differingElements(before, reading(["#grid"], ["FIELDSET"], ["tracks-as-declared"], ["same"])), { structure: null, differing: [], retagged: 1 });
  assert.deepEqual(differingElements(before, reading(["#grid"], ["FIELDSET"], ["tracks-as-declared"], ["moved"])).differing, [0]);
});

test("differing elements: a page with other elements is reported as a change of structure, not compared", () => {
  const before = reading(["#a", ".b"], ["DIV", "DIV"], ["1", "2"]);
  assert.match(differingElements(before, reading(["#a"], ["DIV"], ["1"])).structure, /2 elements before, 1 now/u);
  assert.match(differingElements(before, reading(["#a", ".c"], ["DIV", "DIV"], ["1", "2"])).structure, /element 2 is \.b before and \.c now/u);
});

test("changed values name each change and leave grid tracks out only for a new tag", () => {
  const was = { box: "0,0,10,10", color: "red", "grid-template-columns": "5px 5px", "::beforegrid-template-rows": "1px" };
  const is = { box: "0,0,10,10", color: "blue", "grid-template-columns": "repeat(2, 1fr)", "::beforegrid-template-rows": "auto" };
  assert.deepEqual(changedValues(was, is, true), ["color: red -> blue"]);
  assert.equal(changedValues(was, is, false).length, 3);
  assert.deepEqual(changedValues(was, was, false), []);
});

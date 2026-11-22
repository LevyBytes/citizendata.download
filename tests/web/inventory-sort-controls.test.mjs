import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../docs/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../../docs/styles/main.css", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../../docs/scripts/dashboard.js", import.meta.url), "utf8");

test("inventory headers sort the full dataset and reserve the remainder for Record", () => {
  for (const key of ["record", "category", "value", "date", "media"]) {
    assert.ok(html.includes(`data-inventory-sort="${key}"`));
    assert.ok(html.includes(`inventory-col-${key}`));
  }
  assert.match(css, /\.inventory-sort-button span \{ white-space: nowrap; \}/u);
  assert.match(css, /\.inventory-col-record \{ width: auto; \}/u);
  assert.match(dashboard, /function initialInventorySortDirection\(key\)/u);
  assert.match(dashboard, /return current\.every\(\(record, index\) => record === ascending\[index\]\) \? "descending" : "ascending"/u);
  assert.match(dashboard, /return inventoryRecords\(\)\.filter[\s\S]*?\.sort\(compareInventoryRecords\)/u);
});

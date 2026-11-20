import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadClassicScript, loadClassicScripts } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { api: catalog } = await loadClassicScript(path.join(root, "docs", "scripts", "badge-catalog.js"), "CITIZENDATA_BADGE_CATALOG");
const badgeContext = await loadClassicScripts([
  path.join(root, "docs", "scripts", "badge-catalog.js"),
  path.join(root, "docs", "scripts", "unlockable-badge-catalog.js")
]);
const unlockable = badgeContext.CITIZENDATA_UNLOCKABLE_BADGES;

test("wiki badge catalogue contains validated local images with provenance", async () => {
  assert.equal(catalog.length, 159);
  const paths = new Set();
  for (const entry of catalog) {
    assert.equal(typeof entry.title, "string");
    assert.equal(entry.sourcePage, "https://starcitizen.tools/Titles");
    assert.ok(Array.isArray(entry.images) && entry.images.length > 0);
    for (const image of entry.images) {
      assert.match(image.assetPath, /^assets\/badges\/[a-z0-9-]+\.(?:png|jpg|gif|webp)$/u);
      assert.doesNotMatch(image.assetPath, /--[a-f0-9]{12}\.(?:png|jpg|gif|webp)$/u);
      assert.match(image.finalUrl, /^https:\/\/(?:[^/]+\.)?starcitizen\.tools\//u);
      assert.match(image.contentHash, /^[a-f0-9]{64}$/u);
      const bytes = await readFile(path.join(root, "docs", image.assetPath));
      assert.equal(bytes.byteLength, image.byteLength);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), image.contentHash);
      paths.add(image.assetPath);
    }
  }
  assert.equal(paths.size, 191);
});

test("unlockable badge catalogue follows current wiki earnability evidence", () => {
  assert.equal(unlockable.length, 91);
  assert.equal(new Set(unlockable.map((entry) => `${entry.section}|${entry.title}`)).size, unlockable.length);
  for (const entry of unlockable) {
    assert.equal(entry.sourcePage, "https://starcitizen.tools/Titles");
    assert.ok(Array.isArray(entry.images) && entry.images.length === 1);
    assert.match(entry.images[0].assetPath, /^assets\/badges\/[a-z0-9-]+\.(?:png|jpg|gif|webp)$/u);
  }

  const titles = new Set(unlockable.map((entry) => entry.title));
  for (const included of ["Civilian", "Lt. General", "Beginner Basics Escort", "Vehicle Combat Master", "Cartographer", "2953 Pirate Aggressor", "Most Valuable Poster", "Subscriber"])
    assert.equal(titles.has(included), true, `${included} must remain unlockable.`);
  for (const excluded of ["3.9 Bonus", "2950 - Yellow Flame", "Class G License", "2949 Pirate Aggressor", "Clearance Level Ultra", "VIP"])
    assert.equal(titles.has(excluded), false, `${excluded} is not currently marked unlockable.`);
});

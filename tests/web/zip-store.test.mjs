import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScript } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { api } = await loadClassicScript(path.join(root, "docs/scripts/zip-store.js"), "CitizenDataZip");

test("browser ZIP writer produces deterministic stored archives", () => {
  const files = [
    { name: "data/account.json", bytes: "{\"ok\":true}\n" },
    { name: "index.html", bytes: "<!doctype html>\n" }
  ];
  const first = api.build(files);
  const second = api.build([...files].reverse());
  assert.deepEqual(Array.from(first), Array.from(second));
  const bytes = Buffer.from(first);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.match(bytes.toString("utf8"), /data\/account\.json/u);
  assert.match(bytes.toString("utf8"), /index\.html/u);
});

test("CRC-32 matches the standard check value", () => {
  assert.equal(api.crc32("123456789"), 0xcbf43926);
});

test("ZIP writer rejects traversal, absolute, duplicate, and empty paths", () => {
  for (const name of ["", "/index.html", "../index.html", "a/../index.html", "a\\index.html", "a//index.html"]) {
    assert.throws(() => api.build([{ name, bytes: "x" }]), /Unsafe ZIP path/u);
  }
  assert.throws(() => api.build([{ name: "a.txt", bytes: "x" }, { name: "a.txt", bytes: "y" }]), /Duplicate ZIP path/u);
});

test("ZIP writer uses locale-independent code-unit path ordering", () => {
  const archive = Buffer.from(api.build([{ name: "a.txt", bytes: "a" }, { name: "B.txt", bytes: "b" }]));
  const nameLength = archive.readUInt16LE(26);
  assert.equal(archive.subarray(30, 30 + nameLength).toString("utf8"), "B.txt");
});

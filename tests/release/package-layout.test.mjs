import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPackageFilePolicy, buildStoredZip, crc32, validateManifestVersion } from "../../scripts/package-extension.mjs";
import { composeTarget } from "../../scripts/extension-composition.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("CRC-32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789", "ascii")), 0xcbf43926);
});

test("deterministic stored ZIP begins with a root manifest and ends with EOCD", () => {
  const files = [
    { name: "manifest.json", bytes: Buffer.from("{}\n", "utf8") },
    { name: "shared/protocol.js", bytes: Buffer.from("void 0;\n", "utf8") }
  ];
  const first = buildStoredZip(files);
  const second = buildStoredZip(files);
  assert.deepEqual(first, second);
  assert.equal(first.readUInt32LE(0), 0x04034b50);
  assert.equal(first.subarray(30, 43).toString("utf8"), "manifest.json");
  assert.equal(first.readUInt32LE(first.length - 22), 0x06054b50);
});

test("Chrome manifest versions enforce component bounds and a non-zero value", () => {
  assert.equal(validateManifestVersion("0.1.0.0"), "0.1.0.0");
  for (const invalid of ["0", "0.0.0.0", "1.65536", "01.2", "1.2.3.4.5"]) assert.throws(() => validateManifestVersion(invalid), /Invalid Chrome manifest version/u);
});

test("extension runtime imports resolve inside a private-data-free package inventory", () => {
  const { files } = composeTarget(repositoryRoot, "chromium");
  const names = new Set(files.map((file) => file.name));
  const worker = files.find((file) => file.name === "service-worker.js").bytes.toString("utf8");
  const importBlock = worker.match(/importScripts\(([\s\S]*?)\);/u)?.[1] ?? "";
  const imports = [...importBlock.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(imports.length > 0, "service worker must declare package-local runtime imports");
  for (const imported of imports) assert.equal(names.has(imported), true, `missing service-worker import: ${imported}`);
  assert.throws(() => assertPackageFilePolicy([...files, { name: "private-data/account.json", bytes: Buffer.alloc(0) }]), /not allowed/u);
  assert.throws(() => assertPackageFilePolicy([...files, { name: "manifest.json", bytes: Buffer.alloc(0) }]), /Duplicate/u);
  for (const refused of ["popup/notes.log", "adapters/rsi-api.js.map", "key.pem", "build.crx", "jobs/runner.tmp", ".hidden", "captures/page.html", "citizendata-account.json"]) {
    assert.throws(() => assertPackageFilePolicy([...files, { name: refused, bytes: Buffer.alloc(0) }]), /not allowed/u, refused);
  }
  for (const unsafe of ["../escape.js", "/root.js", "adapters\\back.js", ""]) {
    assert.throws(() => assertPackageFilePolicy([...files, { name: unsafe, bytes: Buffer.alloc(0) }]), /Unsafe/u, unsafe);
  }
});

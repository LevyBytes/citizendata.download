import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPackageFilePolicy, buildStoredZip, collectFiles, crc32, includeLegalFiles, validateManifestVersion } from "../../scripts/package-extension.mjs";

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

test("extension release files include the repository legal notices exactly once", async () => {
  const legalFiles = await Promise.all(["LICENSE", "THIRD_PARTY_NOTICES.md"].map(async (name) => ({
    name,
    bytes: await readFile(path.join(repositoryRoot, name))
  })));
  const files = includeLegalFiles([{ name: "manifest.json", bytes: Buffer.from("{}\n", "utf8") }], legalFiles);
  assert.deepEqual(files.map((file) => file.name), ["manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md"]);
  assert.deepEqual(files[1].bytes, legalFiles[0].bytes);
  assert.deepEqual(files[2].bytes, legalFiles[1].bytes);
  assert.throws(() => includeLegalFiles(files, legalFiles), /already contains a LICENSE/u);
});

test("extension runtime imports resolve inside a private-data-free package inventory", async () => {
  const extensionRoot = path.join(repositoryRoot, "extension");
  const legalFiles = await Promise.all(["LICENSE", "THIRD_PARTY_NOTICES.md"].map(async (name) => ({
    name,
    bytes: await readFile(path.join(repositoryRoot, name))
  })));
  const files = assertPackageFilePolicy(includeLegalFiles(await collectFiles(extensionRoot), legalFiles));
  const names = new Set(files.map((file) => file.name));
  const worker = await readFile(path.join(extensionRoot, "service-worker.js"), "utf8");
  const importBlock = worker.match(/importScripts\(([\s\S]*?)\);/u)?.[1] ?? "";
  const imports = [...importBlock.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(imports.length > 0, "service worker must declare package-local runtime imports");
  for (const imported of imports) assert.equal(names.has(imported), true, `missing service-worker import: ${imported}`);
  assert.throws(() => assertPackageFilePolicy([...files, { name: "private-data/account.json", bytes: Buffer.alloc(0) }]), /not allowed/u);
  assert.throws(() => assertPackageFilePolicy([...files, { name: "manifest.json", bytes: Buffer.alloc(0) }]), /Duplicate/u);
});


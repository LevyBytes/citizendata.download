// The unpacked Chromium folder the packager writes and its ZIP hold the same files: the same paths with the same
// SHA-256, written from one composition. The ZIP is byte-identical each time it is built from the same source.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { composeTarget, writeComposedDirectory } from "../../scripts/extension-composition.mjs";
import { buildStoredZip, packageDifferences, readPackageDirectory, readStoredZip } from "../../scripts/package-extension.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the written Chromium folder and the ZIP match by path and SHA-256", () => {
  const out = mkdtempSync(path.join(repositoryRoot, "tests", "work-temp-chromium-package-"));
  try {
    const { files } = composeTarget(repositoryRoot, "chromium");
    const folder = path.join(out, "chromium");
    writeComposedDirectory(files, folder);
    const zip = buildStoredZip(files);
    const directoryFiles = readPackageDirectory(folder);
    assert.deepEqual(packageDifferences(directoryFiles, readStoredZip(zip)), []);
    assert.deepEqual(directoryFiles.map((file) => file.name), files.map((file) => file.name));
    assert.equal(readStoredZip(zip)[0].name, "LICENSE");
    assert.ok(readStoredZip(zip).some((entry) => entry.name === "manifest.json"), "manifest.json is at the ZIP's root");
    assert.deepEqual(buildStoredZip(composeTarget(repositoryRoot, "chromium").files), zip, "a second build from the same source is byte-identical");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a difference between the folder and the ZIP is reported by path", () => {
  const one = { name: "a.js", bytes: Buffer.from("a") };
  const two = { name: "b.js", bytes: Buffer.from("b") };
  const changed = { name: "b.js", bytes: Buffer.from("B") };
  assert.deepEqual(packageDifferences([one, two], readStoredZip(buildStoredZip([one, changed]))), ["b.js differs"]);
  assert.deepEqual(packageDifferences([one], readStoredZip(buildStoredZip([one, two]))), ["b.js is missing from the unpacked folder"]);
  assert.deepEqual(packageDifferences([one, two], readStoredZip(buildStoredZip([one]))), ["b.js is missing from the ZIP"]);
});

test("writing a composition refuses to replace a file that is already there", () => {
  const out = mkdtempSync(path.join(repositoryRoot, "tests", "work-temp-chromium-package-"));
  try {
    const files = [{ name: "shared/protocol.js", bytes: Buffer.from("x") }];
    writeComposedDirectory(files, out);
    assert.throws(() => writeComposedDirectory(files, out), /EEXIST/u);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

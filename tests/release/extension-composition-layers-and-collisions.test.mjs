// How scripts/extension-composition.mjs builds the Chromium package from extension/, platform/chromium/ and
// manifests/chrome.json, and the layouts it refuses: a path two layers both supply, and a symbolic link.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CompositionError, LEGAL_FILE_NAMES, composeTarget, listLayerFiles } from "../../scripts/extension-composition.mjs";
import { fixtureRepository } from "./compositionfixturerepository.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const refusedWith = (code) => (error) => error instanceof CompositionError && error.code === code;

test("every common and every Chromium overlay file appears once, at its own package path", () => {
  const { files } = composeTarget(repositoryRoot, "chromium");
  const packaged = new Map(files.map((file) => [file.name, file]));
  assert.equal(packaged.size, files.length, "no package path appears twice");
  const common = listLayerFiles(repositoryRoot, "extension");
  const overlay = listLayerFiles(repositoryRoot, "platform/chromium");
  for (const file of [...common, ...overlay]) {
    assert.equal(packaged.get(file.name)?.layer, file.layer, `${file.layer}/${file.name} is package path ${file.name}`);
    assert.deepEqual(packaged.get(file.name).bytes, readFileSync(file.source), file.name);
  }
  assert.deepEqual(overlay.map((file) => file.name), ["offscreen/parser.html", "offscreen/parser.js", "service-worker.js"]);
  assert.equal(files.length, common.length + overlay.length + 1 + LEGAL_FILE_NAMES.length, "the layers, manifest.json and the legal notices, nothing else");
  assert.deepEqual(files.map((file) => file.name), [...files.map((file) => file.name)].sort(), "files are in byte order of their paths");
});

test("manifests/chrome.json becomes manifest.json and each legal notice is included once, unchanged", () => {
  const { files, manifest, version } = composeTarget(repositoryRoot, "chromium");
  const named = (name) => files.filter((file) => file.name === name);
  assert.equal(named("manifest.json").length, 1);
  assert.deepEqual(named("manifest.json")[0].bytes, readFileSync(path.join(repositoryRoot, "manifests", "chrome.json")));
  assert.equal(manifest.background.service_worker, "service-worker.js");
  assert.equal(version, "0.42.2");
  for (const name of LEGAL_FILE_NAMES) {
    assert.equal(named(name).length, 1, name);
    assert.deepEqual(named(name)[0].bytes, readFileSync(path.join(repositoryRoot, name)), name);
  }
});

test("a path that the common source and the overlay both supply is refused, whatever its letter case", () => {
  for (const extra of [{ "extension/service-worker.js": "x\n" }, { "extension/Offscreen/Parser.js": "x\n" }]) {
    const fixture = fixtureRepository(extra);
    try {
      assert.throws(() => composeTarget(fixture.root, "chromium"), refusedWith("PACKAGE_PATH_COLLISION"));
    } finally {
      fixture.remove();
    }
  }
});

test("a layer cannot supply manifest.json or a legal notice of its own", () => {
  for (const extra of [{ "extension/manifest.json": "{}\n" }, { "platform/chromium/LICENSE": "x\n" }, { "extension/third_party_notices.md": "x\n" }]) {
    const fixture = fixtureRepository(extra);
    try {
      assert.throws(() => composeTarget(fixture.root, "chromium"), refusedWith("PACKAGE_PATH_COLLISION"), Object.keys(extra)[0]);
    } finally {
      fixture.remove();
    }
  }
});

test("a symbolic link or junction inside a layer is refused, not followed", () => {
  const fixture = fixtureRepository({ "outside/secret.json": "{}\n" });
  try {
    mkdirSync(path.join(fixture.root, "extension", "linked"), { recursive: true });
    symlinkSync(path.join(fixture.root, "outside"), path.join(fixture.root, "extension", "linked", "outside"), "junction");
    assert.throws(() => composeTarget(fixture.root, "chromium"), refusedWith("PACKAGE_SYMBOLIC_LINK"));
  } finally {
    fixture.remove();
  }
});

test("a minimal layout composes in byte order of its paths, and an unknown target is refused", () => {
  const fixture = fixtureRepository();
  try {
    assert.deepEqual(composeTarget(fixture.root, "chromium").files.map((file) => file.name), [
      "LICENSE", "THIRD_PARTY_NOTICES.md", "manifest.json", "offscreen/parser.html", "offscreen/parser.js", "service-worker.js", "shared/protocol.js"
    ]);
  } finally {
    fixture.remove();
  }
  assert.throws(() => composeTarget(repositoryRoot, "edge"), refusedWith("UNKNOWN_TARGET"));
});

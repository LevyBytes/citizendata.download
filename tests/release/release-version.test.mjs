// The first release is 0.42.1: no file of the repository writes any other 0.42 patch version, so a fixture, a test or
// a document cannot name a release that never existed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASE = "0.42.1";
const TEXT_FILE = /\.(?:c?js|mjs|json|md|html|css|txt|ya?ml|svg|xml|webmanifest)$/iu;
const SAME_MINOR = /(?<![0-9.])0\.42\.([0-9]+)(?![0-9])/gu;

function repositoryFiles() {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  return listed.stdout.split("\0").filter((name) => name && TEXT_FILE.test(name) && !name.startsWith("tests/work-temp"));
}

test(`no file names a 0.42 version other than ${RELEASE}`, () => {
  const found = [];
  for (const name of repositoryFiles()) {
    let text;
    try {
      text = readFileSync(path.join(repositoryRoot, name), "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(SAME_MINOR)) if (match[0] !== RELEASE) found.push(`${name}: ${match[0]}`);
  }
  assert.deepEqual(found, []);
});

test("the manifest and the package carry the release version", () => {
  for (const name of ["package.json", "extension/manifest.json"]) assert.equal(JSON.parse(readFileSync(path.join(repositoryRoot, name), "utf8")).version, RELEASE, name);
});

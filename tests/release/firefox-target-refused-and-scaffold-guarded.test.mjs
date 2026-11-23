// Firefox has a manifest scaffold and no platform overlay: the composer and the packager refuse the Firefox target
// with FIREFOX_PLATFORM_NOT_IMPLEMENTED and write nothing, and the scaffold names no runtime file that does not exist.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CompositionError, FIREFOX_PLATFORM_NOT_IMPLEMENTED, composeTarget } from "../../scripts/extension-composition.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const firefoxManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "manifests", "firefox.json"), "utf8"));
const chromeManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "manifests", "chrome.json"), "utf8"));

test("the composer refuses the Firefox target with its stable code", () => {
  assert.throws(() => composeTarget(repositoryRoot, "firefox"), (error) => error instanceof CompositionError && error.code === FIREFOX_PLATFORM_NOT_IMPLEMENTED);
});

test("the packager refuses --target firefox before it checks, composes or writes anything", () => {
  const out = path.join(repositoryRoot, "tests", `work-temp-firefox-refusal-${process.pid}`);
  rmSync(out, { recursive: true, force: true });
  try {
    const run = spawnSync(process.execPath, ["scripts/package-extension.mjs", "--target", "firefox", "--out", out], { cwd: repositoryRoot, encoding: "utf8" });
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /^FIREFOX_PLATFORM_NOT_IMPLEMENTED: /u);
    assert.doesNotMatch(run.stdout, /PASS|tests? \d+/u, "neither verification nor the test suite ran");
    assert.equal(existsSync(out), false, "no output folder was made");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("the Firefox scaffold is valid metadata at the release version, with a Gecko identity", () => {
  assert.equal(firefoxManifest.manifest_version, 3);
  assert.equal(firefoxManifest.version, "0.42.2");
  assert.match(firefoxManifest.browser_specific_settings.gecko.id, /^[a-z0-9.-]+@[a-z0-9.-]+$/u);
  assert.match(firefoxManifest.browser_specific_settings.gecko.strict_min_version, /^\d+\.\d+$/u);
  for (const key of ["name", "short_name", "description", "homepage_url", "incognito", "host_permissions", "optional_host_permissions", "content_scripts", "content_security_policy"]) {
    assert.deepEqual(firefoxManifest[key], chromeManifest[key], `${key} matches the Chrome manifest`);
  }
});

test("the Firefox scaffold declares no background, no offscreen use and no file the common source lacks", () => {
  assert.equal("background" in firefoxManifest, false, "no background runtime exists for Firefox yet");
  assert.equal(firefoxManifest.permissions.includes("offscreen"), false);
  assert.deepEqual(firefoxManifest.permissions, chromeManifest.permissions.filter((permission) => permission !== "offscreen"));
  const named = [
    firefoxManifest.action.default_popup,
    ...firefoxManifest.content_scripts.flatMap((entry) => entry.js),
    ...Object.values(firefoxManifest.icons),
    ...Object.values(firefoxManifest.action.default_icon)
  ];
  for (const name of new Set(named)) assert.ok(existsSync(path.join(repositoryRoot, "extension", ...name.split("/"))), `extension/${name} exists`);
});

test("the Firefox platform folder says plainly that it is not usable", () => {
  const readme = readFileSync(path.join(repositoryRoot, "platform", "firefox", "README.md"), "utf8");
  assert.match(readme, /^# Firefox platform: not implemented$/mu);
  assert.match(readme, /not usable, not tested in Firefox, not packaged and not published/u);
  assert.match(readme, /FIREFOX_PLATFORM_NOT_IMPLEMENTED/u);
});

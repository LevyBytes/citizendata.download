// What the extension package declares to Chrome.
// What the extension does with these declarations is tested in service-worker.test.mjs and by the end-to-end check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { root, extensionRoot } from "./extensionpackagefiles.mjs";

await import("../../extension/shared/protocol.js");
const Protocol = globalThis.CitizenDataProtocol;

const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));

const packageDocument = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

test("the manifest asks for the least Chrome will let the extension work with", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["alarms", "cookies", "offscreen", "storage", "unlimitedStorage"]);
  assert.deepEqual(manifest.host_permissions, ["https://robertsspaceindustries.com/*"]);
  // RSI's status page is optional and only for diagnosis (PARSER_HARDENING.md §9.3).
  assert.deepEqual(manifest.optional_host_permissions, ["https://status.robertsspaceindustries.com/*"]);
  for (const absent of ["optional_permissions", "externally_connectable", "web_accessible_resources", "key", "update_url", "content_security_policy_sandbox"]) {
    assert.equal(absent in manifest, false, `${absent} must not be declared`);
  }
  assert.equal(manifest.incognito, "not_allowed");
  // The 30 second repeating alarm needs Chrome 120.
  assert.ok(Number(manifest.minimum_chrome_version) >= 120);
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
});

test("the extension and the package carry the same release version", () => {
  assert.match(manifest.version, /^0\.42\.\d+$/u);
  assert.equal(manifest.version_name, manifest.version);
  assert.equal(packageDocument.version, manifest.version);
});

test("the dashboard bridge is injected into the hosted dashboard and into local copies, and nowhere else", () => {
  assert.equal(manifest.content_scripts.length, 1);
  const [bridge] = manifest.content_scripts;
  assert.deepEqual(bridge.matches, [`${Protocol.DASHBOARD_ORIGIN}/*`, Protocol.LOCAL_DASHBOARD_MATCH]);
  assert.deepEqual(bridge.matches, ["https://citizendata.download/*", "file:///*/docs/index.html"]);
  assert.deepEqual(bridge.js, ["shared/protocol.js", "content/dashboard-bridge.js"]);
  assert.equal(bridge.world, "ISOLATED");
  assert.equal(bridge.all_frames, false);
  assert.equal(bridge.run_at, "document_start");
  // No machine-specific path is written into the package.
  assert.doesNotMatch(JSON.stringify(manifest), /(?<![A-Za-z])[A-Za-z]:[\\/]|\/Users\/|\/home\//u);
});

test("every file the manifest names is in the package", async () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  for (const relativePath of new Set(referenced)) {
    await assert.doesNotReject(readFile(path.join(extensionRoot, relativePath)), `Missing manifest file: ${relativePath}`);
  }
});

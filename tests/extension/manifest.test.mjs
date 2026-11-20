// What the extension package declares to Chrome, and a source policy scan that needs no browser.
// What the extension does with these declarations is tested in service-worker.test.mjs and by the end-to-end check.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

await import("../../extension/shared/protocol.js");
const Protocol = globalThis.CitizenDataProtocol;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionRoot = path.join(root, "extension");
const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
const packageDocument = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(fullPath));
    else output.push(fullPath);
  }
  return output;
}

test("the manifest asks for the least Chrome will let the extension work with", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["alarms", "cookies", "offscreen", "storage", "unlimitedStorage"]);
  assert.deepEqual(manifest.host_permissions, ["https://robertsspaceindustries.com/*"]);
  for (const absent of ["optional_permissions", "optional_host_permissions", "externally_connectable", "web_accessible_resources", "key", "update_url", "content_security_policy_sandbox"]) {
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

test("extension pages load only their own scripts and styles", async () => {
  for (const file of (await filesBelow(extensionRoot)).filter((candidate) => candidate.endsWith(".html"))) {
    const source = await readFile(file, "utf8");
    const references = [...source.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/giu)].map((match) => match[1]);
    for (const reference of references) {
      assert.doesNotMatch(reference, /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu, `${path.relative(root, file)} loads ${reference}`);
      await assert.doesNotReject(readFile(path.resolve(path.dirname(file), reference)), `${path.relative(root, file)} names a missing file: ${reference}`);
    }
    // The extension page policy forbids inline script; an inline block would fail silently in Chrome.
    assert.doesNotMatch(source, /<script\b(?![^>]*\bsrc=)[^>]*>/iu, `${path.relative(root, file)} has an inline script`);
    assert.doesNotMatch(source, /\son[a-z]+\s*=/iu, `${path.relative(root, file)} has an inline event handler`);
  }
});

// A scan of the shipped source for constructs the project does not allow. It reads text, so it can only show that a
// construct is absent; it says nothing about behavior.
test("extension source has no string-to-code, no markup injection, and network requests in one module only", async () => {
  const files = (await filesBelow(extensionRoot)).filter((file) => /\.(?:html|js)$/u.test(file));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const name = path.relative(root, file);
    assert.doesNotMatch(source, /\beval\s*\(/u, name);
    assert.doesNotMatch(source, /\bnew\s+Function\s*\(/u, name);
    assert.doesNotMatch(source, /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/u, name);
    assert.doesNotMatch(source, /\bXMLHttpRequest\b|\bWebSocket\s*\(|\bEventSource\s*\(|sendBeacon\s*\(/u, name);
    if (!file.endsWith(path.join("adapters", "rsi-api.js"))) assert.doesNotMatch(source, /\bfetch\s*\(/u, name);
  }
});

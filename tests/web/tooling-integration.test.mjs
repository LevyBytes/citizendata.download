import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFile(path.join(root, ...parts), "utf8");

const html = await read("docs", "index.html");

function scriptSources(markup) {
  return [...markup.matchAll(/<script\s+src="([^"]+)"[^>]*><\/script>/gu)].map((match) => match[1]);
}

test("dashboard loads strict document and media package dependencies before application code", () => {
  const sources = scriptSources(html);
  const expectedOrder = [
    "schema/account-export.schema.js",
    "schema/offline-package.schema.js",
    "scripts/safe-json.js",
    "scripts/account-document.js",
    "scripts/organization-document.js",
    "scripts/zip-store.js",
    "scripts/media-policy.js",
    "scripts/media-file-names.js",
    "scripts/media-materializer.js",
    "scripts/media-package-builder.js",
    "scripts/media-package-reader.js",
    "scripts/canonical-download.js",
    "scripts/dashboard.js"
  ];
  let previous = -1;
  for (const source of expectedOrder) {
    const position = sources.indexOf(source);
    assert.notEqual(position, -1, `Missing dashboard dependency: ${source}`);
    assert.ok(position > previous, `${source} must load after the preceding dependency`);
    previous = position;
  }
});

test("dashboard CSP permits same-origin reads and the two exact public RSI image hosts", () => {
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u)?.[1];
  assert.ok(csp, "The dashboard must declare a CSP.");
  assert.match(csp, /(?:^|;)\s*connect-src\s+'self'\s+https:\/\/robertsspaceindustries\.com\s+https:\/\/media\.robertsspaceindustries\.com\s*(?:;|$)/u);
  assert.match(csp, /(?:^|;)\s*img-src\s+'self'\s+data:\s+blob:\s*(?:;|$)/u);
  assert.doesNotMatch(csp, /connect-src[^;]*\*/u);
  assert.match(csp, /object-src\s+'none'/u);
  assert.match(csp, /form-action\s+'none'/u);
});

// How the dashboard accepts a result, which request each control sends, and what Build offers are checked in the
// browser by tests/web/validate-dashboard.mjs and, with the real extension, by tests/extension/e2e/check-extension.mjs.

// A source policy scan of the extension that needs no browser: extension pages load only their own scripts and
// styles, and the source has no string-to-code, no markup injection, and network requests in one module only.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { root, extensionRoot } from "./extensionpackagefiles.mjs";

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

// A source policy scan of the extension that needs no browser: extension pages load only their own scripts and
// styles, and the source has no string-to-code, no markup injection, and network requests in one module only. It
// scans the composed Chromium package, the files that ship, so the platform overlay is scanned with the common source.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { packageFiles } from "./extensionpackagefiles.mjs";

const where = (file) => `${file.name} (${file.layer})`;

test("extension pages load only their own scripts and styles", () => {
  for (const file of [...packageFiles.values()].filter((candidate) => candidate.name.endsWith(".html"))) {
    const source = file.bytes.toString("utf8");
    const references = [...source.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/giu)].map((match) => match[1]);
    for (const reference of references) {
      assert.doesNotMatch(reference, /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu, `${where(file)} loads ${reference}`);
      // Resolved inside the package, as Chrome resolves it in the installed extension.
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.name), reference));
      assert.ok(packageFiles.has(target), `${where(file)} names a file the package does not hold: ${reference}`);
    }
    // The extension page policy forbids inline script; an inline block would fail silently in Chrome.
    assert.doesNotMatch(source, /<script\b(?![^>]*\bsrc=)[^>]*>/iu, `${where(file)} has an inline script`);
    assert.doesNotMatch(source, /\son[a-z]+\s*=/iu, `${where(file)} has an inline event handler`);
  }
});

// A scan of the shipped source for constructs the project does not allow. It reads text, so it can only show that a
// construct is absent; it says nothing about behavior.
test("extension source has no string-to-code, no markup injection, and network requests in one module only", () => {
  const files = [...packageFiles.values()].filter((file) => /\.(?:html|js)$/u.test(file.name));
  assert.ok(files.some((file) => file.name === "service-worker.js") && files.some((file) => file.name === "offscreen/parser.js"), "the platform overlay is scanned");
  for (const file of files) {
    const source = file.bytes.toString("utf8");
    const name = where(file);
    assert.doesNotMatch(source, /\beval\s*\(/u, name);
    assert.doesNotMatch(source, /\bnew\s+Function\s*\(/u, name);
    assert.doesNotMatch(source, /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/u, name);
    assert.doesNotMatch(source, /\bXMLHttpRequest\b|\bWebSocket\s*\(|\bEventSource\s*\(|sendBeacon\s*\(/u, name);
    if (file.name !== "adapters/rsi-api.js") assert.doesNotMatch(source, /\bfetch\s*\(/u, name);
  }
});

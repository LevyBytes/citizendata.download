// A small stand-in repository for the composition tests: the layers, the Chrome manifest and the legal notices, each
// file named by its repository path. It is written below tests/ in a work-temp- folder and removed by `remove`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MINIMAL_CHROMIUM_FILES = Object.freeze({
  "extension/shared/protocol.js": "\"use strict\";\n",
  "platform/chromium/service-worker.js": "\"use strict\";\n",
  "platform/chromium/offscreen/parser.html": "<!doctype html>\n",
  "platform/chromium/offscreen/parser.js": "\"use strict\";\n",
  "manifests/chrome.json": "{ \"manifest_version\": 3, \"version\": \"0.42.2\" }\n",
  "LICENSE": "MIT\n",
  "THIRD_PARTY_NOTICES.md": "# Notices\n"
});

export function fixtureRepository(extraFiles = {}) {
  const root = mkdtempSync(path.join(testsFolder, "work-temp-composition-"));
  for (const [name, text] of Object.entries({ ...MINIMAL_CHROMIUM_FILES, ...extraFiles })) {
    const destination = path.join(root, ...name.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, text);
  }
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

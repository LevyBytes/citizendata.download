import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const timestampSource = await readFile(path.join(root, "docs", "scripts", "file-timestamp.js"), "utf8");
const source = await readFile(path.join(root, "docs", "scripts", "canonical-download.js"), "utf8");

function loadApi() {
  const module = { exports: {} };
  const context = vm.createContext({ module, TextEncoder, globalThis: {} });
  vm.runInContext(timestampSource, context, { filename: "file-timestamp.js" });
  vm.runInContext(source, context, { filename: "canonical-download.js" });
  return module.exports;
}

test("canonical account filename is deterministic and path safe", () => {
  const api = loadApi();
  assert.equal(api.canonicalFileName({ account: { handle: "Citizen / ../ Pilot" }, exportedAt: "2026-11-17T10:11:12.345Z" }), "citizendata-Citizen-Pilot-2026-11-17-101112-345Z.json");
  assert.equal(api.canonicalFileName({ account: { handle: "***" }, exportedAt: "invalid" }), "citizendata-account-undated-000000-000Z.json");
});

test("canonical downloader serializes the full document once and revokes its Blob URL", () => {
  const api = loadApi();
  const clicks = [];
  const appended = [];
  const revoked = [];
  const scheduled = [];
  const anchor = { click() { clicks.push({ href: this.href, download: this.download }); }, remove() { this.removed = true; } };
  const documentValue = { body: { append(value) { appended.push(value); } }, createElement(name) { assert.equal(name, "a"); return anchor; } };
  const blobs = [];
  class FakeBlob { constructor(parts, options) { this.parts = parts; this.options = options; blobs.push(this); } }
  const urlApi = { createObjectURL(blob) { assert.equal(blob, blobs[0]); return "blob:canonical"; }, revokeObjectURL(url) { revoked.push(url); } };
  const accountDocument = { schemaVersion: 1, account: { handle: "Pilot" }, exportedAt: "2026-11-17T10:11:12.000Z", integrity: { algorithm: "SHA-256", contentHash: "a".repeat(64) } };
  const result = api.download(accountDocument, { documentValue, urlApi, BlobValue: FakeBlob, schedule(callback, delay) { scheduled.push(delay); callback(); } });
  assert.equal(result.fileName, "citizendata-Pilot-2026-11-17-101112-000Z.json");
  assert.deepEqual(JSON.parse(blobs[0].parts[0]), accountDocument);
  assert.equal(blobs[0].options.type, "application/json");
  assert.equal(appended[0], anchor);
  assert.deepEqual(clicks, [{ href: "blob:canonical", download: result.fileName }]);
  assert.equal(anchor.removed, true);
  assert.deepEqual(scheduled, [30000]);
  assert.deepEqual(revoked, ["blob:canonical"]);
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fileNamesSource = await readFile(path.join(root, "docs/scripts/media-file-names.js"), "utf8");
const accountDocumentSource = await readFile(path.join(root, "docs/scripts/account-document.js"), "utf8");
const source = await readFile(path.join(root, "docs/scripts/media-materializer.js"), "utf8");

export function load() {
  const sandbox = vm.createContext({ console, URL, TextEncoder, Uint8Array, ArrayBuffer, DataView, crypto: globalThis.crypto, setTimeout, clearTimeout, DOMException, module: { exports: {} } });
  sandbox.globalThis = sandbox;
  vm.runInContext(fileNamesSource, sandbox, { filename: "file-names.js" });
  vm.runInContext(accountDocumentSource, sandbox, { filename: "account-document.js" });
  vm.runInContext(source, sandbox, { filename: "materializer.js" });
  return sandbox.CitizenDataMediaMaterializer;
}

export const policy = {
  allowedImageHosts: ["media.robertsspaceindustries.com"],
  allowedMediaTypes: ["image/png"],
  maximumAssets: 10,
  maximumBytes: 100000,
  maximumBytesPerAsset: 100000,
  maximumWidth: 1000,
  maximumHeight: 1000,
  minimumInterRequestDelayMs: 100,
  maximumInterRequestDelayMs: 200,
  maximumConcurrency: 4,
  maximumAttempts: 3,
  minimumRetryDelayMs: 750,
  maximumRetryDelayMs: 1750
};

export function png(width = 2, height = 3) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

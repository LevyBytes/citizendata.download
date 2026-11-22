import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { ban, throttle } from "../support/extension-harness/virtual-clock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fileNamesSource = await readFile(path.join(root, "docs/scripts/media-file-names.js"), "utf8");
const accountDocumentSource = await readFile(path.join(root, "docs/scripts/account-document.js"), "utf8");
const source = await readFile(path.join(root, "docs/scripts/media-materializer.js"), "utf8");
// The image run's pace comes from the dashboard's copies of the settings, the controller and the pace history (§14).
const pacingSources = await Promise.all(["request-pacing-settings.js", "pace-controller.js", "pace-history.js"].map(async (name) => [name, await readFile(path.join(root, "docs/scripts", name), "utf8")]));

// SHA-256 that answers at once: the virtual clock cannot pass real asynchronous hashing. The bytes and the hash are
// the same as crypto.subtle's.
const immediateCrypto = Object.freeze({
  getRandomValues: (array) => globalThis.crypto.getRandomValues(array),
  randomUUID: () => globalThis.crypto.randomUUID(),
  subtle: Object.freeze({
    async digest(algorithm, data) {
      if ((algorithm?.name ?? algorithm) !== "SHA-256") throw new TypeError("Only SHA-256 is used here.");
      const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
      const hash = createHash("sha256").update(bytes).digest();
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    }
  })
});

export function load() {
  const sandbox = vm.createContext({ console, URL, TextEncoder, Uint8Array, ArrayBuffer, DataView, crypto: immediateCrypto, setTimeout, clearTimeout, DOMException, module: { exports: {} } });
  sandbox.globalThis = sandbox;
  vm.runInContext(fileNamesSource, sandbox, { filename: "file-names.js" });
  vm.runInContext(accountDocumentSource, sandbox, { filename: "account-document.js" });
  for (const [name, pacingSource] of pacingSources) vm.runInContext(pacingSource, sandbox, { filename: name });
  vm.runInContext(source, sandbox, { filename: "materializer.js" });
  return sandbox.CitizenDataMediaMaterializer;
}

// The pacing the sandbox's materializer reads, and today's 1x pace for the tests that assert today's schedule (§15.3).
export function pacing() {
  const sandbox = vm.createContext({ console, TextEncoder, crypto: globalThis.crypto, module: { exports: {} } });
  sandbox.globalThis = sandbox;
  for (const [name, pacingSource] of pacingSources) vm.runInContext(pacingSource, sandbox, { filename: name });
  const settings = sandbox.CITIZENDATA_REQUEST_PACING;
  return { settings, controller: sandbox.CitizenDataPaceController, atBaseline: () => JSON.parse(JSON.stringify(sandbox.CitizenDataPaceController.atBaseline(settings))) };
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

export { imageHost, virtualTime } from "./mediamaterializerclockandimagehost.mjs";
export { ban, throttle };

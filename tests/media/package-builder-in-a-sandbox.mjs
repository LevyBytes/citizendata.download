import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const accountSchema = JSON.parse(await readFile(path.join(root, "schema/account-export.schema.json"), "utf8"));
export const offlineSchema = JSON.parse(await readFile(path.join(root, "schema/offline-package.schema.json"), "utf8"));

export async function load() {
  const context = vm.createContext({ console, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, crypto: globalThis.crypto, module: { exports: {} } });
  context.globalThis = context;
  for (const name of ["shared/account-document.js", "docs/scripts/file-timestamp.js", "docs/scripts/zip-store.js", "docs/scripts/media-package-builder.js"]) {
    vm.runInContext(await readFile(path.join(root, name), "utf8"), context, { filename: name });
  }
  return context;
}

export function into(context, value) {
  return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
}

export function materializedInto(context, value) {
  const converted = into(context, { ...value, files: value.files.map((file) => ({ name: file.name })) });
  value.files.forEach((file, index) => {
    converted.files[index].bytes = vm.runInContext(`Uint8Array.from(${JSON.stringify(Array.from(file.bytes))})`, context);
  });
  return converted;
}

export const policy = {
  allowedImageHosts: ["robertsspaceindustries.com"],
  allowedMediaTypes: ["image/png"],
  maximumAssets: 10,
  maximumBytes: 100000,
  maximumBytesPerAsset: 10000,
  maximumWidth: 1000,
  maximumHeight: 1000,
  minimumInterRequestDelayMs: 100,
  maximumInterRequestDelayMs: 200,
  maximumConcurrency: 4,
  maximumAttempts: 3,
  minimumRetryDelayMs: 750,
  maximumRetryDelayMs: 1750
};

export function successfulMaterialization() {
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    assets: [{
      assetId: "a".repeat(64),
      sourceImageKeys: ["c".repeat(64), "d".repeat(64)],
      sourceUrl: "https://robertsspaceindustries.com/media/a.png",
      finalUrl: "https://robertsspaceindustries.com/media/a.png",
      status: "downloaded",
      relativePath: `media/aa/${"b".repeat(64)}.png`,
      displayFileName: "test--thumbnail--aaaaaaaaaaaa.png",
      mediaType: "image/png",
      byteLength: bytes.byteLength,
      pixelWidth: 1,
      pixelHeight: 1,
      contentHash: "b".repeat(64),
      fetchedAt: "2026-11-17T20:00:00.000Z",
      attempts: 1,
      errorCode: null,
      entityReferences: [{ recordType: "pledge", recordKey: "pledge:1", role: "thumbnail" }]
    }],
    files: [{ name: `media/aa/${"b".repeat(64)}.png`, bytes }],
    totalBytes: bytes.byteLength,
    downloadedBytes: bytes.byteLength
  };
}

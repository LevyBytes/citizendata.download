import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { baseAccountDocument } from "../fixtures/account-document.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const context = await loadClassicScripts([
  path.join(root, "docs", "schema", "account-export.schema.js"),
  path.join(root, "docs", "schema", "offline-package.schema.js"),
  path.join(root, "docs", "scripts", "account-document.js"),
  path.join(root, "docs", "scripts", "file-timestamp.js"),
  path.join(root, "docs", "scripts", "zip-store.js"),
  path.join(root, "docs", "scripts", "safe-json.js"),
  path.join(root, "docs", "scripts", "media-file-names.js"),
  path.join(root, "docs", "scripts", "media-materializer.js"),
  path.join(root, "docs", "scripts", "media-package-builder.js"),
  path.join(root, "docs", "scripts", "media-package-reader.js")
], { URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, crypto: globalThis.crypto, structuredClone, setTimeout });

test("stored image ZIP validates lazily and supplies only the plan delta", async () => {
  context.accountSource = JSON.stringify(baseAccountDocument());
  const account = await context.CitizenDataAccountDocument.stampIntegrity(vm.runInContext("JSON.parse(accountSource)", context));
  const imageBytes = new Uint8Array([1, 2, 3, 4]);
  const contentHash = await context.CitizenDataMediaMaterializer.sha256(imageBytes);
  const sourceUrl = "https://robertsspaceindustries.com/media/a.png";
  const imageKey = await context.CitizenDataMediaMaterializer.sha256(sourceUrl);
  const relativePath = `media/${contentHash.slice(0, 2)}/${contentHash}.png`;
  const entityReferences = [{ recordType: "pledge", recordKey: "pledge-1", role: "thumbnail" }];
  const materialized = {
    assets: [{
      assetId: imageKey, sourceImageKeys: [imageKey], sourceUrl, finalUrl: sourceUrl, status: "downloaded", relativePath, displayFileName: "image.png",
      mediaType: "image/png", byteLength: 4, pixelWidth: 1, pixelHeight: 1, contentHash, fetchedAt: "2026-11-18T00:00:00.000Z", attempts: 1, errorCode: null,
      entityReferences
    }],
    files: [{ name: relativePath, bytes: imageBytes }],
    totalBytes: 4,
    downloadedBytes: 4
  };
  const policy = {
    allowedImageHosts: ["robertsspaceindustries.com"], allowedMediaTypes: ["image/png"], maximumAssets: 5000, maximumBytes: 536870912, maximumBytesPerAsset: 16777216,
    maximumWidth: 16384, maximumHeight: 16384, minimumInterRequestDelayMs: 100, maximumInterRequestDelayMs: 200, maximumConcurrency: 4, maximumAttempts: 3,
    minimumRetryDelayMs: 750, maximumRetryDelayMs: 1750
  };
  context.materializedSource = JSON.stringify({ ...materialized, files: materialized.files.map((file) => ({ name: file.name, bytes: [...file.bytes] })) });
  context.policySource = JSON.stringify(policy);
  const realmMaterialized = vm.runInContext("(() => { const value = JSON.parse(materializedSource); value.files = value.files.map(file => ({ ...file, bytes: new Uint8Array(file.bytes) })); return value; })()", context);
  const realmPolicy = vm.runInContext("JSON.parse(policySource)", context);
  const result = await context.CitizenDataMediaPackage.buildArchive({
    accountDocument: account, materialized: realmMaterialized, policy: realmPolicy, generatedAt: "2026-11-18T00:00:00.000Z", startedAt: "2026-11-18T00:00:00.000Z",
    endedAt: "2026-11-18T00:00:00.000Z", version: "0.42.1"
  });
  const loaded = await context.CitizenDataMediaPackageReader.open(new Blob([result.archive]));
  assert.deepEqual([...new Uint8Array(await (await loaded.fileBlob(relativePath, "image/png")).arrayBuffer())], [1, 2, 3, 4]);
  const nextUrl = "https://robertsspaceindustries.com/media/b.png";
  const nextKey = await context.CitizenDataMediaMaterializer.sha256(nextUrl);
  const delta = await context.CitizenDataMediaPackageReader.prepareDelta([
    { normalizedUrl: sourceUrl, imageKey, sourceImageKeys: [imageKey], references: entityReferences, title: "Existing" },
    { normalizedUrl: nextUrl, imageKey: nextKey, sourceImageKeys: [nextKey], references: entityReferences, title: "New" }
  ], loaded);
  assert.equal(delta.reused.assets.length, 1);
  assert.equal(delta.pending.length, 1);
  assert.equal(delta.pending[0].normalizedUrl, nextUrl);
  assert.equal(delta.reused.assets[0].status, "reused");
});

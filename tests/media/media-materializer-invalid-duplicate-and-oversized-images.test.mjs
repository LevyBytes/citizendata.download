import assert from "node:assert/strict";
import { test } from "node:test";
import { load, png, policy } from "./media-materializer-in-a-sandbox.mjs";

test("invalid payloads become explicit failed receipts without stopping later assets", async () => {
  const api = load();
  const entries = [
    { normalizedUrl: "https://media.robertsspaceindustries.com/a.png", imageKey: "a".repeat(64), title: "A", references: [{ recordType: "pledge", recordKey: "p1", role: "thumbnail" }] },
    { normalizedUrl: "https://media.robertsspaceindustries.com/b.png", imageKey: "b".repeat(64), title: "B", references: [{ recordType: "pledge", recordKey: "p2", role: "thumbnail" }] }
  ];
  let count = 0;
  const result = await api.materialize(entries, policy, {
    fetcher: async (url) => {
      count += 1;
      const bytes = count === 1 ? new Uint8Array([1, 2, 3]) : png();
      return { status: 200, url, headers: { get: () => "image/png" }, arrayBuffer: async () => bytes.buffer };
    },
    sleep: async () => {}
  });
  assert.deepEqual(Array.from(result.assets, (asset) => asset.status), ["failed", "downloaded"]);
  assert.equal(result.assets[0].errorCode, "INVALID_MEDIA_TYPE");
});

test("identical image content is stored once while retaining both asset receipts", async () => {
  const api = load();
  const entries = [
    { normalizedUrl: "https://media.robertsspaceindustries.com/a.png", imageKey: "a".repeat(64), title: "A", references: [{ recordType: "pledge", recordKey: "p1", role: "thumbnail" }] },
    { normalizedUrl: "https://media.robertsspaceindustries.com/b.png", imageKey: "b".repeat(64), title: "B", references: [{ recordType: "pledge", recordKey: "p2", role: "thumbnail" }] }
  ];
  const result = await api.materialize(entries, policy, {
    fetcher: async (url) => {
      const bytes = png();
      return { status: 200, url, headers: { get: () => "image/png" }, arrayBuffer: async () => bytes.buffer };
    },
    sleep: async () => {}
  });
  assert.equal(result.assets.length, 2);
  assert.equal(result.files.length, 1);
  assert.equal(result.totalBytes, png().byteLength);
  assert.equal(result.downloadedBytes, png().byteLength * 2);
});

test("declared oversized responses fail before their body is buffered", async () => {
  const api = load();
  const entries = [{ normalizedUrl: "https://media.robertsspaceindustries.com/large.png", imageKey: "c".repeat(64), title: "Large", references: [{ recordType: "pledge", recordKey: "p1", role: "thumbnail" }] }];
  let bodyRead = false;
  const result = await api.materialize(entries, policy, {
    fetcher: async (url) => ({
      status: 200,
      url,
      headers: { get: (name) => name === "content-length" ? String(policy.maximumBytesPerAsset + 1) : "image/png" },
      arrayBuffer: async () => { bodyRead = true; return png().buffer; }
    })
  });
  assert.equal(bodyRead, false);
  assert.equal(result.assets[0].errorCode, "BYTE_LIMIT");
});

test("dimension validation supports the declared AVIF and WebP lossless formats", () => {
  const api = load();
  const webp = new Uint8Array(30);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBP"), 8);
  webp.set(new TextEncoder().encode("VP8L"), 12);
  webp[20] = 0x2f;
  webp[21] = 1;
  webp[22] = 0x80;
  assert.equal(api.mediaTypeFromMagic(webp), "image/webp");
  assert.deepEqual(JSON.parse(JSON.stringify(api.dimensions(webp, "image/webp"))), { width: 2, height: 3 });

  const avif = new Uint8Array(40);
  avif.set(new TextEncoder().encode("ftyp"), 4);
  avif.set(new TextEncoder().encode("avif"), 8);
  avif.set(new TextEncoder().encode("ispe"), 20);
  const view = new DataView(avif.buffer);
  view.setUint32(28, 640);
  view.setUint32(32, 480);
  assert.equal(api.mediaTypeFromMagic(avif), "image/avif");
  assert.deepEqual(JSON.parse(JSON.stringify(api.dimensions(avif, "image/avif"))), { width: 640, height: 480 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionMedia, FETCHED_AT, Materializer, MediaStore, connected, handedOver, image, plain } from "./kept-images-loaded-with-fixture-images.mjs";

test("an image is kept only when its bytes are the image it claims to be", async () => {
  const item = await image(1);
  const good = handedOver(item);
  const stored = await MediaStore.checkFile(good, "2026-11-19T09:00:00.000Z");
  assert.deepEqual(stored.entry, { assetId: item.asset.assetId, contentHash: item.asset.contentHash, mediaType: "image/png", byteLength: 32, pixelWidth: 8, pixelHeight: 6, fetchedAt: FETCHED_AT, storedAt: "2026-11-19T09:00:00.000Z" });
  assert.deepEqual(stored.data, { assetId: item.asset.assetId, base64: good.base64 });
  // No address is kept, so none can be told.
  assert.deepEqual(Object.keys(MediaStore.publicEntry(stored.entry)).sort(), ["assetId", "byteLength", "contentHash", "fetchedAt", "mediaType", "pixelHeight", "pixelWidth"]);

  const refused = async (changes) => (await MediaStore.checkFile({ ...good, ...changes }, FETCHED_AT)).code;
  assert.equal(await refused({ contentHash: "0".repeat(64) }), "IMAGE_HASH_MISMATCH");
  assert.equal(await refused({ assetId: "not-a-hash" }), "INVALID_IMAGE_IDENTIFIER");
  assert.equal(await refused({ mediaType: "image/jpeg" }), "INVALID_IMAGE_TYPE");
  assert.equal(await refused({ mediaType: "image/svg+xml" }), "INVALID_IMAGE_TYPE");
  assert.equal(await refused({ pixelWidth: 0 }), "INVALID_IMAGE_TYPE");
  assert.equal(await refused({ fetchedAt: "yesterday" }), "INVALID_IMAGE_TIME");
  assert.equal(await refused({ base64: "not base64!" }), "INVALID_IMAGE_BYTES");
  assert.equal(await refused({ base64: "" }), "INVALID_IMAGE_BYTES");
  assert.equal(await refused({ note: "an extra field" }), "INVALID_IMAGE");
  // Bytes that are not an image at all, under their own correct hash.
  const text = new TextEncoder().encode("<script>not an image</script>");
  assert.equal(await refused({ contentHash: await Materializer.sha256(text), base64: Buffer.from(text).toString("base64") }), "INVALID_IMAGE_TYPE");
  assert.equal((await MediaStore.checkFile(null, FETCHED_AT)).code, "INVALID_IMAGE");
  assert.equal(MediaStore.isIdentifierList([item.asset.assetId], 2), true);
  for (const list of [[], [item.asset.assetId, item.asset.assetId], ["x"], "text", [item.asset.assetId, "a".repeat(64), "b".repeat(64)]]) assert.equal(MediaStore.isIdentifierList(list, 2), false);
});

test("many images travel in batches, and a response that cannot hold them all is asked for again", async () => {
  const { harness, request, sent } = await connected();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  // Seventy small images and three of about three mebibytes each.
  const items = await Promise.all([...Array.from({ length: 70 }, (_, index) => image(index + 1)), ...[201, 202, 203].map((seed) => image(seed, 3 * 1024 * 1024))]);
  const kept = await ExtensionMedia.index(request);
  sent.length = 0;
  const outcome = await ExtensionMedia.keep({ assets: items.map((item) => item.asset), readFile: async (asset) => items.find((item) => item.asset.assetId === asset.assetId).bytes, kept, request });
  assert.deepEqual(outcome, { stored: 73, refused: 0, already: 0 });
  // Sixty-four to a request, and no request above the text limit.
  assert.ok(sent.length >= 3 && sent.length <= 5 && sent.every((type) => type === "KEEP_IMAGES"), JSON.stringify(sent));
  assert.equal(plain(await harness.popup.request("GET_BUILD_HISTORY")).images.count, 73);

  const opened = ExtensionMedia.createPackage({ plan: items.map((item) => item.entry), kept: await ExtensionMedia.index(request), accountDocument: {}, request });
  sent.length = 0;
  await opened.preload();
  // The three large images do not fit one eight mebibyte response with the rest, so the dashboard asks again.
  assert.ok(sent.length >= 2 && sent.every((type) => type === "GET_KEPT_IMAGE_FILES"), JSON.stringify(sent));
  const last = items.at(-1);
  assert.deepEqual(new Uint8Array(await (await opened.fileBlob(last.asset.relativePath)).arrayBuffer()), last.bytes);
});

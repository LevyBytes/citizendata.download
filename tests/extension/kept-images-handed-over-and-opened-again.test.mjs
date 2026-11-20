import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionMedia, FETCHED_AT, connected, handedOver, image, plain } from "./kept-images-loaded-with-fixture-images.mjs";

test("the dashboard hands downloaded images to the extension and opens them again like an Images ZIP", async () => {
  const { harness, request, sent } = await connected();
  const items = await Promise.all([1, 2, 3].map((seed) => image(seed)));
  const plan = items.map((item) => item.entry);
  const assets = items.map((item) => item.asset);
  const readFile = async (asset) => items.find((item) => item.asset.assetId === asset.assetId).bytes;

  // Build history off: nothing is kept, and the dashboard does not try.
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: false });
  const off = await ExtensionMedia.index(request);
  assert.deepEqual([off.keeping, off.images.size], [false, 0]);
  assert.deepEqual(await request("KEEP_IMAGES", { files: [handedOver(items[0])] }), { ok: false, code: "IMAGES_NOT_KEPT", message: "Build history is off, so the extension keeps no new images." });
  assert.equal(ExtensionMedia.createPackage({ plan, kept: off, accountDocument: {}, request }), null);

  // On: the three images go over in one request and are listed without any address.
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  sent.length = 0;
  const kept = await ExtensionMedia.index(request);
  assert.equal(kept.keeping, true);
  assert.deepEqual(await ExtensionMedia.keep({ assets: [...assets, { ...assets[0] }, { assetId: "f".repeat(64), status: "failed", relativePath: null }], readFile, kept, request }), { stored: 3, refused: 0, already: 0 });
  assert.deepEqual(sent, ["GET_KEPT_IMAGES", "KEEP_IMAGES"]);
  const listed = await request("GET_KEPT_IMAGES", null);
  assert.equal(JSON.stringify(listed).includes("robertsspaceindustries"), false);
  assert.deepEqual(listed.images.map((entry) => entry.assetId).sort(), assets.map((asset) => asset.assetId).sort());
  assert.deepEqual(plain(await harness.popup.request("GET_BUILD_HISTORY")).images, { count: 3, bytes: 96 });
  // Handing the same package over again stores nothing.
  assert.deepEqual(await ExtensionMedia.keep({ assets, readFile, kept: await ExtensionMedia.index(request), request }), { stored: 0, refused: 0, already: 3 });

  // A later visit: the kept images of this plan, plus one image the extension does not keep.
  const absent = await image(9);
  const again = await ExtensionMedia.index(request);
  const opened = ExtensionMedia.createPackage({ plan: [...plan, absent.entry], kept: again, accountDocument: { account: { localAccountId: "local-1", handle: "SyntheticCitizen" } }, request });
  assert.equal(opened.fromExtension, true);
  assert.deepEqual([opened.manifest.assets.length, opened.manifest.summary.reused, opened.manifest.summary.missing, opened.manifest.account.handle], [3, 3, 1, "SyntheticCitizen"]);
  assert.deepEqual(plain(opened.manifest.assets[0]), {
    assetId: assets[0].assetId, sourceImageKeys: [assets[0].assetId], sourceUrl: plan[0].normalizedUrl, finalUrl: plan[0].normalizedUrl, status: "reused", relativePath: assets[0].relativePath,
    displayFileName: null, mediaType: "image/png", byteLength: 32, pixelWidth: 8, pixelHeight: 6, contentHash: assets[0].contentHash, fetchedAt: FETCHED_AT, attempts: 0, errorCode: null, entityReferences: plan[0].references
  });
  // Images asked for together arrive in one request, and each is the image that was handed over.
  sent.length = 0;
  const blobs = await Promise.all(assets.map((asset) => opened.fileBlob(asset.relativePath, asset.mediaType)));
  assert.deepEqual(sent, ["GET_KEPT_IMAGE_FILES"]);
  for (const [index, blob] of blobs.entries()) {
    assert.equal(blob.type, "image/png");
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), items[index].bytes);
  }
  // Read once, an image is not asked for again.
  await opened.preload();
  assert.equal(await opened.fileBlob(assets[1].relativePath), blobs[1]);
  assert.deepEqual(sent, ["GET_KEPT_IMAGE_FILES"]);
  await assert.rejects(() => opened.fileBlob(absent.asset.relativePath), /does not keep this image/u);

  // Build history off again: what is kept can still be read, and nothing new is kept.
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: false });
  const reading = await ExtensionMedia.index(request);
  assert.deepEqual([reading.keeping, reading.images.size], [false, 3]);
  assert.equal((await request("GET_KEPT_IMAGE_FILES", { assetIds: [assets[2].assetId] })).files.length, 1);
  assert.equal((await request("KEEP_IMAGES", { files: [handedOver(absent)] })).code, "IMAGES_NOT_KEPT");
});

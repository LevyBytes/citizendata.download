import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionMedia, MediaStore, connected, handedOver, image, plain } from "./kept-images-loaded-with-fixture-images.mjs";

test("what the dashboard sends is checked, and only the popup can delete the kept images", async () => {
  const { harness, request } = await connected();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  const [first, second] = await Promise.all([image(1), image(2)]);

  // One request can keep some images and refuse others, each with its reason.
  const mixed = await request("KEEP_IMAGES", { files: [handedOver(first), handedOver(second, { contentHash: "0".repeat(64) })] });
  assert.deepEqual(mixed, { ok: true, stored: [first.asset.assetId], refused: [{ assetId: second.asset.assetId, code: "IMAGE_HASH_MISMATCH" }] });
  // A payload that names an address never reaches the store.
  assert.equal((await request("KEEP_IMAGES", { files: [{ ...handedOver(second), sourceUrl: second.entry.normalizedUrl }] })).code, "FORBIDDEN_PAYLOAD_FIELD");
  for (const payload of [null, {}, { files: [] }, { files: "text" }, { files: Array.from({ length: MediaStore.LIMITS.filesPerRequest + 1 }, () => handedOver(first)) }]) {
    assert.equal((await request("KEEP_IMAGES", payload)).code, "INVALID_IMAGE_REQUEST", JSON.stringify(payload)?.slice(0, 60));
  }
  for (const payload of [null, { assetIds: [] }, { assetIds: ["x"] }, { assetIds: [first.asset.assetId, first.asset.assetId] }]) {
    assert.equal((await request("GET_KEPT_IMAGE_FILES", payload)).code, "INVALID_IMAGE_REQUEST");
  }
  // An image the extension does not keep is neither returned nor promised.
  assert.deepEqual(await request("GET_KEPT_IMAGE_FILES", { assetIds: [second.asset.assetId, first.asset.assetId] }), { ok: true, files: [{ assetId: first.asset.assetId, base64: handedOver(first).base64 }], remaining: [] });
  const kept = await ExtensionMedia.index(request);
  const opened = ExtensionMedia.createPackage({ plan: [first.entry], kept, accountDocument: {}, request });

  // The dashboard cannot delete them; the popup can, and the dashboard is then told the image is gone.
  assert.equal((await request("CLEAR_KEPT_IMAGES", null)).code, "UNKNOWN_REQUEST");
  assert.equal((await ExtensionMedia.index(request)).images.size, 1);
  const cleared = plain(await harness.popup.request("CLEAR_KEPT_IMAGES"));
  assert.deepEqual([cleared.ok, cleared.images, cleared.settings.enabled], [true, { count: 0, bytes: 0 }, true]);
  await assert.rejects(() => opened.fileBlob(first.asset.relativePath), /no longer keeps this image/u);

  // Clearing all local data removes kept images with everything else.
  await request("KEEP_IMAGES", { files: [handedOver(first)] });
  assert.equal((await harness.repository.listMedia()).length, 1);
  await harness.popup.request("CLEAR_ALL");
  assert.equal((await harness.repository.listMedia()).length, 0);
  assert.equal((await harness.repository.getMediaData([first.asset.assetId])).length, 0);
});

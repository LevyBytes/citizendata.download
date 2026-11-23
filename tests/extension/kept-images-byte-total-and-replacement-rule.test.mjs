// Kept images have a byte total as well as a count (MediaStore.planKeep), checked where they are written: a request
// that would pass either is refused whole. An image kept already with the same bytes is not written again; other
// bytes at the same identifier replace it only when fetched later. A refused decision writes nothing.
import assert from "node:assert/strict";
import test from "node:test";
import { FETCHED_AT, MediaStore, connected, handedOver, image, png } from "./kept-images-loaded-with-fixture-images.mjs";

const id = (digit) => String(digit).repeat(64);
const entry = (assetId, byteLength, changes = {}) => ({ assetId, contentHash: "a".repeat(64), byteLength, fetchedAt: FETCHED_AT, ...changes });
const item = (value) => ({ entry: value, data: { assetId: value.assetId, base64: "" } });
// The next worker gets a repository whose saveMedia is `save`, given the repository's own.
const wrapSave = (harness, save) => {
  harness.stopWorker();
  const own = harness.repository.saveMedia;
  harness.repository = { ...harness.repository, saveMedia: (items, decide) => save(own, items, decide) };
};

test("the byte total: up to it is kept, one byte over refuses the request, and a replacement counts its difference", () => {
  const total = MediaStore.LIMITS.storedBytes;
  assert.equal(total, 2 * 1024 * 1024 * 1024);
  const kept = [entry(id(1), total - 10)];
  assert.equal(MediaStore.planKeep(kept, [item(entry(id(2), 10))]).ok, true);
  assert.deepEqual(MediaStore.planKeep(kept, [item(entry(id(2), 11))]), { ok: false, code: "IMAGE_BYTES_LIMIT" });
  const later = "2026-11-20T08:00:00.000Z";
  assert.equal(MediaStore.planKeep(kept, [item(entry(id(1), total, { contentHash: "b".repeat(64), fetchedAt: later }))]).ok, true);
  assert.equal(MediaStore.planKeep(kept, [item(entry(id(1), total + 1, { contentHash: "b".repeat(64), fetchedAt: later }))]).code, "IMAGE_BYTES_LIMIT");
  const full = Array.from({ length: MediaStore.LIMITS.images }, (_, index) => entry(index.toString(16).padStart(64, "0"), 1));
  assert.deepEqual(MediaStore.planKeep(full, [item(entry(id(9), 1))]), { ok: false, code: "IMAGE_LIMIT" });
});

test("the same image again is not written; other bytes replace it only when fetched later", async () => {
  const { harness, request } = await connected();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  const first = await image(1);
  assert.deepEqual(await request("KEEP_IMAGES", { files: [handedOver(first)] }), { ok: true, stored: [first.asset.assetId], refused: [] });
  let writes = 0;
  wrapSave(harness, (own, items, decide) => own(items, (kept) => {
    const decision = decide(kept);
    writes += decision.writes?.length ?? 0;
    return decision;
  }));
  assert.deepEqual(await request("KEEP_IMAGES", { files: [handedOver(first)] }), { ok: true, stored: [first.asset.assetId], refused: [] });
  assert.equal(writes, 0, "an image kept already with the same bytes is not written again");
  const changed = png(1, 8);
  const contentHash = await MediaStore.sha256(changed);
  const replacing = (fetchedAt) => handedOver(first, { contentHash, base64: Buffer.from(changed).toString("base64"), fetchedAt });
  assert.deepEqual(await request("KEEP_IMAGES", { files: [replacing("2026-11-18T08:00:00.000Z")] }), { ok: true, stored: [], refused: [{ assetId: first.asset.assetId, code: "OLDER_THAN_KEPT" }] });
  assert.deepEqual(await request("KEEP_IMAGES", { files: [replacing(FETCHED_AT)] }), { ok: true, stored: [], refused: [{ assetId: first.asset.assetId, code: "OLDER_THAN_KEPT" }] }, "the same time is not later");
  assert.deepEqual(await request("KEEP_IMAGES", { files: [replacing("2026-11-20T08:00:00.000Z")] }), { ok: true, stored: [first.asset.assetId], refused: [] });
  const [kept] = await harness.repository.listMedia();
  assert.deepEqual([kept.contentHash, kept.byteLength, writes], [contentHash, changed.byteLength, 1]);
});

test("a refused decision writes nothing, and the extension says why", async () => {
  const { harness, request } = await connected();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  const first = await image(1);
  wrapSave(harness, (own, items) => own(items, () => ({ ok: false, code: "IMAGE_BYTES_LIMIT" })));
  const refused = await request("KEEP_IMAGES", { files: [handedOver(first)] });
  assert.deepEqual([refused.ok, refused.code, refused.message], [false, "IMAGE_BYTES_LIMIT", "The extension keeps at most 2 GiB of images."]);
  assert.equal((await harness.repository.listMedia()).length, 0);
});

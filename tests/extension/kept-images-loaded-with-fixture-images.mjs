import { createExtensionHarness } from "../support/extension-harness.mjs";

await import("../../shared/account-document.js");
await import("../../docs/scripts/media-materializer.js");
await import("../../docs/scripts/extension-media.js");
await import("../../extension/storage/media-store.js");
export const Materializer = globalThis.CitizenDataMediaMaterializer;
export const ExtensionMedia = globalThis.CitizenDataExtensionMedia;
export const MediaStore = globalThis.CitizenDataMediaStore;

const SMALL = { counts: { pledges: 4, buybacks: 4, orders: 1, storeCredit: 1, uec: 1, rec: 1, olderHangarLogRows: 1, prospects: 1, recruits: 1, legacyRecruits: 1, organizationMembers: 2 } };
export const FETCHED_AT = "2026-11-19T08:00:00.000Z";
export const plain = (value) => JSON.parse(JSON.stringify(value));

// The smallest bytes that are a PNG by their first eight, with a width and height where a PNG keeps them.
export function png(seed, extra = 0) {
  const bytes = new Uint8Array(32 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 6]);
  bytes[24] = seed;
  for (let index = 32; index < bytes.length; index += 1) bytes[index] = (seed + index) % 251;
  return bytes;
}

// One planned image as the dashboard's image plan lists it, and the asset its Images ZIP records for it.
export async function image(seed, extra = 0) {
  const normalizedUrl = `https://media.robertsspaceindustries.com/synthetic/${seed}.png`;
  const bytes = png(seed, extra);
  const contentHash = await Materializer.sha256(bytes);
  const imageKey = await Materializer.sha256(normalizedUrl);
  return {
    bytes,
    entry: { imageKey, normalizedUrl, sourceImageKeys: [], references: [{ recordType: "pledge", recordKey: `pledge:${seed}`, role: "thumbnail" }], title: `Image ${seed}` },
    asset: { assetId: imageKey, status: "downloaded", relativePath: `media/${contentHash.slice(0, 2)}/${contentHash}.png`, contentHash, mediaType: "image/png", pixelWidth: 8, pixelHeight: 6, fetchedAt: FETCHED_AT, sourceUrl: normalizedUrl }
  };
}

export const handedOver = (item, changes = {}) => ({
  assetId: item.asset.assetId, contentHash: item.asset.contentHash, mediaType: "image/png", pixelWidth: 8, pixelHeight: 6, fetchedAt: FETCHED_AT,
  base64: Buffer.from(item.bytes).toString("base64"), ...changes
});

export async function connected() {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const sent = [];
  const request = async (type, payload) => {
    sent.push(type);
    return plain(await tab.request(type, payload));
  };
  return { harness, tab, request, sent };
}

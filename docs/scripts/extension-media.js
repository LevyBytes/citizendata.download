(function initializeCitizenDataExtensionMedia(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataExtensionMedia = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataExtensionMedia(root) {
  "use strict";

  // Images the extension keeps, as the dashboard uses them.
  //
  // The dashboard downloads every image itself and builds the Images ZIP, with or without the extension. When the
  // extension's build history is on, the dashboard also hands it each downloaded image, and on a later visit opens
  // what the extension keeps exactly as it opens an Images ZIP: the same manifest shape and the same `fileBlob`, so
  // showing an image, reusing it in the next download, and writing the next ZIP need no second code path.
  //
  // The extension is told no address. An image travels under its asset identifier and content hash, and the bytes it
  // gives back are checked here against that hash before they are shown or reused.
  const SOURCE_NAME = "Images kept in the extension";
  const HEX = /^[a-f0-9]{64}$/u;
  const EXTENSIONS = Object.freeze({ "image/avif": "avif", "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });
  const MEBIBYTE = 1024 * 1024;
  // The base64 text one request carries, kept well inside what one browser message holds.
  const REQUEST_TEXT = 6 * MEBIBYTE;
  const BATCH_DELAY_MS = 20;

  function toBase64(bytes) {
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(start, start + 0x8000));
    return root.btoa(binary);
  }

  function fromBase64(text) {
    const binary = root.atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  // What the extension keeps: `{ keeping, limits, images }` with the images by asset identifier, or null when it
  // does not answer. An extension from before kept images answers that it does not know the request.
  async function index(request) {
    let response;
    try { response = await request("GET_KEPT_IMAGES", null); } catch { return null; }
    if (!response?.ok || !Array.isArray(response.images)) return null;
    const images = new Map();
    for (const image of response.images) {
      if (!image || !HEX.test(image.assetId) || !HEX.test(image.contentHash) || !Object.hasOwn(EXTENSIONS, image.mediaType)) continue;
      if (!Number.isSafeInteger(image.byteLength) || image.byteLength < 1 || typeof image.fetchedAt !== "string") continue;
      images.set(image.assetId, image);
    }
    return {
      keeping: response.keeping === true,
      limits: {
        filesPerRequest: positiveInteger(response.limits?.filesPerRequest, 64),
        requestText: Math.min(positiveInteger(response.limits?.requestText, REQUEST_TEXT), REQUEST_TEXT),
        identifiersPerRequest: positiveInteger(response.limits?.identifiersPerRequest, 256)
      },
      images
    };
  }

  // The images of `plan` the extension keeps, as a package the dashboard opens like an Images ZIP, or null when it
  // keeps none of them. `plan` is the image plan of the open account document.
  function createPackage({ plan, kept, accountDocument, request }) {
    const assets = [];
    const byPath = new Map();
    for (const entry of Array.isArray(plan) ? plan : []) {
      const image = kept?.images?.get(entry.imageKey);
      if (!image) continue;
      const relativePath = `media/${image.contentHash.slice(0, 2)}/${image.contentHash}.${EXTENSIONS[image.mediaType]}`;
      const sourceImageKeys = Array.isArray(entry.sourceImageKeys) && entry.sourceImageKeys.length ? [...entry.sourceImageKeys] : [entry.imageKey];
      assets.push({
        assetId: entry.imageKey,
        sourceImageKeys,
        sourceUrl: entry.normalizedUrl,
        finalUrl: entry.normalizedUrl,
        status: "reused",
        relativePath,
        displayFileName: root.CitizenDataMediaFileNames?.deriveDisplayFileName?.({ title: entry.title, role: entry.references?.[0]?.role, imageKey: entry.imageKey, sourceUrl: entry.normalizedUrl, mediaType: image.mediaType }) ?? null,
        mediaType: image.mediaType,
        byteLength: image.byteLength,
        pixelWidth: image.pixelWidth,
        pixelHeight: image.pixelHeight,
        contentHash: image.contentHash,
        fetchedAt: image.fetchedAt,
        attempts: 0,
        errorCode: null,
        entityReferences: entry.references ?? []
      });
      if (!byPath.has(relativePath)) byPath.set(relativePath, { assetId: entry.imageKey, contentHash: image.contentHash, mediaType: image.mediaType });
    }
    if (!assets.length) return null;

    const blobs = new Map();
    const waiting = new Map();
    let timer = null;

    function settle(assetId, error, blob) {
      for (const waiter of waiting.get(assetId) ?? []) error ? waiter.reject(error) : waiter.resolve(blob);
      waiting.delete(assetId);
    }

    // Asks the extension for the bytes of these images, as many requests as it takes, and checks each one.
    async function read(assetIds) {
      let remaining = [...assetIds];
      const wanted = new Map([...byPath].filter(([, file]) => assetIds.includes(file.assetId)).map(([relativePath, file]) => [file.assetId, { relativePath, ...file }]));
      while (remaining.length) {
        const asked = remaining.slice(0, kept.limits.identifiersPerRequest);
        const response = await request("GET_KEPT_IMAGE_FILES", { assetIds: asked });
        if (!response?.ok || !Array.isArray(response.files)) throw new Error(response?.message ?? "The extension did not return the kept images.");
        const returned = new Set();
        for (const file of response.files) {
          const expected = wanted.get(file?.assetId);
          if (!expected || typeof file.base64 !== "string") continue;
          returned.add(file.assetId);
          const bytes = fromBase64(file.base64);
          if (await root.CitizenDataMediaMaterializer.sha256(bytes) !== expected.contentHash) {
            settle(file.assetId, new Error("A kept image does not match its content hash."));
            continue;
          }
          const blob = new Blob([bytes], { type: expected.mediaType });
          blobs.set(expected.relativePath, blob);
          settle(file.assetId, null, blob);
        }
        const later = new Set(Array.isArray(response.remaining) ? response.remaining : []);
        for (const assetId of asked) if (!returned.has(assetId) && !later.has(assetId)) settle(assetId, new Error("The extension no longer keeps this image."));
        // A response that returns nothing and promises nothing more would never end.
        if (!returned.size && [...later].some((assetId) => asked.includes(assetId))) throw new Error("The extension returned no kept image.");
        remaining = [...remaining.slice(asked.length), ...asked.filter((assetId) => later.has(assetId))];
      }
    }

    function flush() {
      timer = null;
      const assetIds = [...waiting.keys()];
      read(assetIds).catch((error) => { for (const assetId of assetIds) settle(assetId, error); });
    }

    // Images asked for within a moment of each other travel in one request.
    function fileBlob(relativePath) {
      const file = byPath.get(relativePath);
      if (!file) return Promise.reject(new Error(`The extension does not keep this image: ${relativePath}`));
      const ready = blobs.get(relativePath);
      if (ready) return Promise.resolve(ready);
      return new Promise((resolve, reject) => {
        const waiters = waiting.get(file.assetId) ?? [];
        waiters.push({ resolve, reject });
        waiting.set(file.assetId, waiters);
        if (timer === null) timer = root.setTimeout(flush, BATCH_DELAY_MS);
      });
    }

    // Reads every image of the package before a download reuses them, so they arrive in a few requests.
    async function preload() {
      await Promise.all([...byPath.keys()].map((relativePath) => fileBlob(relativePath)));
    }

    const account = { localAccountId: accountDocument?.account?.localAccountId ?? null, handle: accountDocument?.account?.handle ?? null };
    const totalBytes = [...byPath.values()].reduce((total, file) => total + (kept.images.get(file.assetId)?.byteLength ?? 0), 0);
    return Object.freeze({
      fromExtension: true,
      manifest: Object.freeze({ packageId: null, account, assets: Object.freeze(assets), summary: Object.freeze({ desiredAssets: plan.length, downloaded: 0, reused: assets.length, missing: plan.length - assets.length, blocked: 0, failed: 0, skipped: 0, totalBytes }), integrity: null }),
      fileBlob,
      preload
    });
  }

  // Hands the extension the images of an opened package that it does not keep yet. `readFile(asset)` gives the
  // verified bytes of one image. Returns how many were stored, refused, and already kept.
  async function keep({ assets, readFile, kept, request }) {
    const outcome = { stored: 0, refused: 0, already: 0 };
    const pending = [];
    const seen = new Set();
    for (const asset of Array.isArray(assets) ? assets : []) {
      if (!["downloaded", "reused"].includes(asset?.status) || !asset.relativePath || !HEX.test(asset.assetId) || seen.has(asset.assetId)) continue;
      seen.add(asset.assetId);
      if (kept.images.get(asset.assetId)?.contentHash === asset.contentHash) outcome.already += 1;
      else pending.push(asset);
    }
    let batch = [];
    let text = 0;
    async function send() {
      if (!batch.length) return;
      const response = await request("KEEP_IMAGES", { files: batch });
      if (!response?.ok) throw new Error(response?.message ?? "The extension did not keep the images.");
      outcome.stored += Array.isArray(response.stored) ? response.stored.length : 0;
      outcome.refused += Array.isArray(response.refused) ? response.refused.length : 0;
      batch = [];
      text = 0;
    }
    for (const asset of pending) {
      const base64 = toBase64(await readFile(asset));
      if (batch.length && (batch.length >= kept.limits.filesPerRequest || text + base64.length > kept.limits.requestText)) await send();
      batch.push({ assetId: asset.assetId, contentHash: asset.contentHash, mediaType: asset.mediaType, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight, fetchedAt: asset.fetchedAt, base64 });
      text += base64.length;
    }
    await send();
    return outcome;
  }

  return Object.freeze({ SOURCE_NAME, createPackage, index, keep });
});

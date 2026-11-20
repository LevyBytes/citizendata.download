(function initializeCitizenDataMediaStore(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataMediaStore = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataMediaStore(root) {
  "use strict";

  // Images the dashboard downloaded, kept while the build history is on so that the dashboard can show them again
  // without its Images ZIP.
  //
  // The extension never downloads an image and never learns where one came from. The dashboard hands each image over
  // under its asset identifier (the hash of its address) with its content hash, and the extension keeps it only if
  // the bytes have that hash and are an image of the stated type. What it gives back is checked by the dashboard
  // against the same content hash.
  const HEX = /^[a-f0-9]{64}$/u;
  const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;
  const EXTENSIONS = Object.freeze({ "image/avif": "avif", "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });
  const MEBIBYTE = 1024 * 1024;
  const LIMITS = Object.freeze({
    // The dashboard's own limits for one image (docs/scripts/media-policy.js).
    bytesPerImage: 16 * MEBIBYTE,
    dimension: 16384,
    // One request or response carries a batch, so thousands of images do not take thousands of messages.
    filesPerRequest: 64,
    requestText: 24 * MEBIBYTE,
    responseText: 8 * MEBIBYTE,
    identifiersPerRequest: 512,
    images: 20000
  });

  function typeFromMagic(bytes) {
    const text = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(text(0, 6))) return "image/gif";
    if (bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
    if (bytes.length >= 12 && text(4, 8) === "ftyp" && ["avif", "avis"].includes(text(8, 12))) return "image/avif";
    return null;
  }

  function fromBase64(value) {
    if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !BASE64.test(value)) return null;
    let binary;
    try { binary = root.atob(value); } catch { return null; }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function sha256(bytes) {
    const digest = new Uint8Array(await root.crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  const isDimension = (value) => Number.isSafeInteger(value) && value >= 1 && value <= LIMITS.dimension;

  // One image as the dashboard hands it over: `{ ok: true, entry, data }` to store, or `{ ok: false, code }`.
  async function checkFile(file, storedAt) {
    if (!file || typeof file !== "object" || Array.isArray(file)) return { ok: false, code: "INVALID_IMAGE" };
    const keys = Object.keys(file).sort().join();
    if (keys !== "assetId,base64,contentHash,fetchedAt,mediaType,pixelHeight,pixelWidth") return { ok: false, code: "INVALID_IMAGE" };
    if (!HEX.test(file.assetId) || !HEX.test(file.contentHash)) return { ok: false, code: "INVALID_IMAGE_IDENTIFIER" };
    if (!Object.hasOwn(EXTENSIONS, file.mediaType) || !isDimension(file.pixelWidth) || !isDimension(file.pixelHeight)) return { ok: false, code: "INVALID_IMAGE_TYPE" };
    if (typeof file.fetchedAt !== "string" || file.fetchedAt.length > 40 || Number.isNaN(Date.parse(file.fetchedAt))) return { ok: false, code: "INVALID_IMAGE_TIME" };
    if (typeof file.base64 !== "string" || file.base64.length > Math.ceil(LIMITS.bytesPerImage / 3) * 4) return { ok: false, code: "IMAGE_TOO_LARGE" };
    const bytes = fromBase64(file.base64);
    if (!bytes || bytes.byteLength === 0) return { ok: false, code: "INVALID_IMAGE_BYTES" };
    if (bytes.byteLength > LIMITS.bytesPerImage) return { ok: false, code: "IMAGE_TOO_LARGE" };
    if (typeFromMagic(bytes) !== file.mediaType) return { ok: false, code: "INVALID_IMAGE_TYPE" };
    if (await sha256(bytes) !== file.contentHash) return { ok: false, code: "IMAGE_HASH_MISMATCH" };
    return {
      ok: true,
      entry: { assetId: file.assetId, contentHash: file.contentHash, mediaType: file.mediaType, byteLength: bytes.byteLength, pixelWidth: file.pixelWidth, pixelHeight: file.pixelHeight, fetchedAt: file.fetchedAt, storedAt },
      data: { assetId: file.assetId, base64: file.base64 }
    };
  }

  // What the dashboard is told about a kept image. No address is kept, so none is told.
  function publicEntry(entry) {
    return { assetId: entry.assetId, contentHash: entry.contentHash, mediaType: entry.mediaType, byteLength: entry.byteLength, pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight, fetchedAt: entry.fetchedAt };
  }

  function isIdentifierList(value, maximum) {
    return Array.isArray(value) && value.length >= 1 && value.length <= maximum && value.every((item) => typeof item === "string" && HEX.test(item)) && new Set(value).size === value.length;
  }

  function summary(entries) {
    return { count: entries.length, bytes: entries.reduce((total, entry) => total + (Number.isSafeInteger(entry.byteLength) ? entry.byteLength : 0), 0) };
  }

  return Object.freeze({ EXTENSIONS, LIMITS, checkFile, fromBase64, isIdentifierList, publicEntry, sha256, summary, typeFromMagic });
});

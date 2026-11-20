(function initializeCitizenDataMediaFileNames(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataMediaFileNames = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataMediaFileNames() {
  "use strict";

  const MIME_EXTENSIONS = Object.freeze({
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  });
  const GENERIC_BASENAMES = new Set(["asset", "image", "img", "subscribers-vault-thumbnail", "thumbnail"]);
  const WINDOWS_RESERVED = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)$/iu;
  const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

  function sourceBasename(sourceUrl) {
    try {
      const pathname = new URL(sourceUrl).pathname;
      return decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
    } catch {
      return "";
    }
  }

  function stem(fileName) {
    const dot = fileName.lastIndexOf(".");
    return dot > 0 ? fileName.slice(0, dot) : fileName;
  }

  function slug(value, fallback = "asset") {
    const normalized = String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/&/gu, " and ")
      .replace(/[^a-z0-9]+/giu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase();
    const bounded = (normalized || fallback).slice(0, 96).replace(/[. ]+$/gu, "");
    return WINDOWS_RESERVED.test(bounded) ? `asset-${bounded}` : bounded || fallback;
  }

  function validatedExtension(mediaType) {
    const extension = MIME_EXTENSIONS[String(mediaType ?? "").toLowerCase()];
    if (!extension) throw new TypeError(`Unsupported image media type: ${mediaType}`);
    return extension;
  }

  function deriveDisplayFileName({ title, role = "image", imageKey, sourceUrl, mediaType }) {
    const normalizedKey = String(imageKey ?? "").toLowerCase();
    if (!SHA256_PATTERN.test(normalizedKey)) throw new TypeError("imageKey must be a lowercase SHA-256 digest.");
    const originalStem = slug(stem(sourceBasename(sourceUrl)), "");
    const genericSource = !originalStem || GENERIC_BASENAMES.has(originalStem);
    const semanticStem = slug(title || (genericSource ? "asset" : originalStem));
    const roleStem = slug(role, "image").slice(0, 32);
    const suffix = normalizedKey.slice(0, 12);
    return `${semanticStem}--${roleStem}--${suffix}.${validatedExtension(mediaType)}`;
  }

  return Object.freeze({ deriveDisplayFileName, sourceBasename, slug, validatedExtension });
});


(() => {
  "use strict";
  globalThis.CITIZENDATA_MEDIA_POLICY = Object.freeze({
    allowedImageHosts: Object.freeze(["robertsspaceindustries.com", "media.robertsspaceindustries.com"]),
    allowedMediaTypes: Object.freeze(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]),
    maximumAssets: 5000,
    maximumBytes: 512 * 1024 * 1024,
    maximumBytesPerAsset: 16 * 1024 * 1024,
    maximumWidth: 16384,
    maximumHeight: 16384,
    minimumInterRequestDelayMs: 100,
    maximumInterRequestDelayMs: 200,
    maximumConcurrency: 4,
    maximumAttempts: 3,
    minimumRetryDelayMs: 750,
    maximumRetryDelayMs: 1750
  });
})();

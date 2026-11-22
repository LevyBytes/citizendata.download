(() => {
  "use strict";
  // The pace of the image run comes from the request pacing settings (scripts/request-pacing-settings.js), which load
  // first; the other limits are this file's own.
  const images = globalThis.CITIZENDATA_REQUEST_PACING?.images;
  if (!images) throw new Error("request-pacing-settings.js must load before media-policy.js.");
  globalThis.CITIZENDATA_MEDIA_POLICY = Object.freeze({
    allowedImageHosts: Object.freeze(["robertsspaceindustries.com", "media.robertsspaceindustries.com"]),
    allowedMediaTypes: Object.freeze(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]),
    maximumAssets: 5000,
    maximumBytes: 512 * 1024 * 1024,
    maximumBytesPerAsset: 16 * 1024 * 1024,
    maximumWidth: 16384,
    maximumHeight: 16384,
    minimumInterRequestDelayMs: images.startGapMinimumMs,
    maximumInterRequestDelayMs: images.startGapMaximumMs,
    maximumConcurrency: images.concurrency,
    maximumAttempts: images.attempts,
    minimumRetryDelayMs: images.retryMinimumMs,
    maximumRetryDelayMs: images.retryMaximumMs
  });
})();

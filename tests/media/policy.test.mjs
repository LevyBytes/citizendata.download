// The limits the dashboard ships for downloading public images. How the downloader keeps to them is tested in
// materializer.test.mjs, and in the browser by tests/web/validate-dashboard.mjs.
import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/scripts/request-pacing-settings.js");
await import("../../docs/scripts/media-policy.js");
const policy = globalThis.CITIZENDATA_MEDIA_POLICY;

test("images come from RSI's two public hosts, four at a time, at a steady gap, within fixed size limits", () => {
  assert.deepEqual([...policy.allowedImageHosts], ["robertsspaceindustries.com", "media.robertsspaceindustries.com"]);
  assert.deepEqual([...policy.allowedMediaTypes], ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
  assert.equal(policy.maximumConcurrency, 4);
  assert.deepEqual([policy.minimumInterRequestDelayMs, policy.maximumInterRequestDelayMs], [100, 200]);
  assert.equal(policy.maximumBytes, 512 * 1024 * 1024);
  assert.equal(policy.maximumBytesPerAsset, 16 * 1024 * 1024);
  assert.equal(policy.maximumAssets, 5000);
  assert.equal(policy.maximumAttempts, 3);
  assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.allowedImageHosts));
});

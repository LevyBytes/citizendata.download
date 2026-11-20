(function initializeCitizenDataMediaMaterializer(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataMediaMaterializer = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataMediaMaterializer(root) {
  "use strict";

  const ALLOWED_MEDIA_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
  const TRACKING_PARAMETERS = /^(?:_ga|_gl|fbclid|gclid|utm_(?:campaign|content|medium|source|term))$/iu;
  const SHA256 = /^[a-f0-9]{64}$/u;
  const encoder = new TextEncoder();

  function hostAllowed(hostname, allowedHosts) {
    const host = hostname.toLowerCase();
    return allowedHosts.some((allowed) => host === String(allowed).toLowerCase());
  }

  function normalizeImageUrl(value, allowedHosts) {
    if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) throw new TypeError("At least one image host is required.");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !hostAllowed(url.hostname, allowedHosts)) throw new TypeError("Image URL is not an allowed public HTTPS image.");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETERS.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  }

  async function sha256(value) {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    const digest = new Uint8Array(await root.crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function mediaExtension(mediaType) {
    return ({ "image/avif": "avif", "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[mediaType] ?? null;
  }

  function mediaTypeFromMagic(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))) return "image/gif";
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && ["avif", "avis"].includes(String.fromCharCode(...bytes.slice(8, 12)))) return "image/avif";
    return null;
  }

  function dimensions(bytes, mediaType) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (mediaType === "image/png" && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
    if (mediaType === "image/gif" && bytes.length >= 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    if (mediaType === "image/webp" && bytes.length >= 30) {
      const kind = String.fromCharCode(...bytes.slice(12, 16));
      if (kind === "VP8X") return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
      if (kind === "VP8L" && bytes[20] === 0x2f) return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10)
      };
      if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff
      };
    }
    if (mediaType === "image/avif" && bytes.length >= 24) {
      for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
        if (String.fromCharCode(...bytes.slice(offset, offset + 4)) !== "ispe") continue;
        const width = view.getUint32(offset + 8);
        const height = view.getUint32(offset + 12);
        if (width > 0 && height > 0) return { width, height };
      }
    }
    if (mediaType === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
        const length = view.getUint16(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) break;
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
        }
        offset += 2 + length;
      }
    }
    return null;
  }

  function collectImageReferences(document) {
    const references = [];
    const seenObjects = new Set();
    function visit(value, context = { recordType: "account", recordKey: document?.account?.localAccountId ?? "account" }) {
      if (!value || typeof value !== "object" || seenObjects.has(value)) return;
      seenObjects.add(value);
      if (Array.isArray(value.images)) {
        for (const image of value.images) {
          if (!image || typeof image.url !== "string" || root.CitizenDataAccountDocument.isPlaceholderImage(image)) continue;
          references.push({
            imageKey: typeof image.imageKey === "string" && SHA256.test(image.imageKey) ? image.imageKey : null,
            image,
            reference: { recordType: context.recordType, recordKey: context.recordKey, role: image.role ?? "image" },
            title: value.title ?? value.name ?? value.moniker ?? value.handle ?? context.recordKey
          });
        }
      }
      for (const [key, child] of Object.entries(value)) {
        if (key === "images") continue;
        if (Array.isArray(child)) {
          child.forEach((item, index) => {
            if (!item || typeof item !== "object") return;
            let recordType = context.recordType;
            if (key === "pledges") recordType = "pledge";
            else if (key === "buybacks") recordType = "buyback";
            // The images of a buy-back's own page, of the ships that page lists, and of the ship a CCU buy-back
            // leads to belong to buy-backs.
            else if (key === "buybackDetails" || key === "buybackUpgradePrices") recordType = "buyback";
            else if (key === "items") recordType = "containedItem";
            else if (["prospects", "recruits"].includes(key)) recordType = "referral";
            else if (key === "members") recordType = "organizationMember";
            else if (key === "memberships") recordType = "organization";
            else if (key === "subscriptions") recordType = "subscription";
            const recordKey = item.recordKey ?? item.pledgeId ?? item.buybackId ?? item.subscriptionId ?? item.organizationSid ?? `${context.recordKey}:${key}:${index}`;
            visit(item, { recordType, recordKey: String(recordKey) });
          });
        } else if (child && typeof child === "object") {
          const childContext = key === "profile"
            ? { recordType: "profile", recordKey: document?.account?.localAccountId ?? "profile" }
            : context;
          visit(child, childContext);
        }
      }
    }
    visit(document);
    return references;
  }

  async function plan(document, policy) {
    const byUrl = new Map();
    for (const item of collectImageReferences(document)) {
      let normalizedUrl;
      try { normalizedUrl = normalizeImageUrl(item.image.url, policy.allowedImageHosts); }
      catch { continue; }
      const existing = byUrl.get(normalizedUrl) ?? { normalizedUrl, references: [], sourceImageKeys: [], title: item.title };
      existing.references.push(item.reference);
      if (item.imageKey && !existing.sourceImageKeys.includes(item.imageKey)) existing.sourceImageKeys.push(item.imageKey);
      byUrl.set(normalizedUrl, existing);
    }
    const entries = [];
    for (const entry of byUrl.values()) entries.push({ ...entry, sourceImageKeys: entry.sourceImageKeys.sort(), imageKey: await sha256(entry.normalizedUrl) });
    return entries.sort((left, right) => left.imageKey < right.imageKey ? -1 : left.imageKey > right.imageKey ? 1 : 0);
  }

  async function responseBytes(response, limit) {
    const declaredLength = Number.parseInt(response.headers?.get?.("content-length") ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error("BYTE_LIMIT");
    const reader = response.body?.getReader?.();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > limit) throw new Error("BYTE_LIMIT");
      return bytes;
    }
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        length += chunk.byteLength;
        if (length > limit) {
          await reader.cancel("BYTE_LIMIT");
          throw new Error("BYTE_LIMIT");
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    if (length === 0) throw new Error("BYTE_LIMIT");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async function materialize(entries, policy, options) {
    if (!Array.isArray(entries) || entries.length > policy.maximumAssets) throw new RangeError("Image plan exceeds the configured asset limit.");
    const fetcher = options?.fetcher;
    if (typeof fetcher !== "function") throw new TypeError("A public-image transport is required.");
    const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const now = options.now ?? (() => new Date().toISOString());
    const random = options.random ?? Math.random;
    const minimumStartDelay = policy.minimumInterRequestDelayMs;
    const maximumStartDelay = policy.maximumInterRequestDelayMs ?? minimumStartDelay;
    const concurrency = Math.max(1, Math.min(4, policy.maximumConcurrency ?? 4));
    const maximumAttempts = Math.max(1, Math.min(3, policy.maximumAttempts ?? 3));
    const minimumRetryDelay = policy.minimumRetryDelayMs ?? 750;
    const maximumRetryDelay = policy.maximumRetryDelayMs ?? 1750;
    const assets = new Array(entries.length);
    const filesByPath = new Map();
    let totalBytes = 0;
    let downloadedBytes = 0;
    let completed = 0;
    let nextIndex = 0;
    let starts = 0;
    let activeRequests = 0;
    let startGate = Promise.resolve();

    function jitter(minimum, maximum) {
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum) throw new TypeError("Invalid image request delay policy.");
      return Math.round(minimum + (maximum - minimum) * Math.max(0, Math.min(1, random())));
    }

    async function waitForStartSlot() {
      const previous = startGate;
      let release;
      startGate = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        if (starts > 0) await sleep(jitter(minimumStartDelay, maximumStartDelay));
        starts += 1;
      } finally {
        release();
      }
    }

    async function fetchWithRetry(entry, index) {
      let lastError = null;
      for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        if (options.signal?.aborted) throw new DOMException("Image materialization cancelled.", "AbortError");
        await waitForStartSlot();
        // A download cancelled while this request waited its turn starts nothing more.
        if (options.signal?.aborted) throw new DOMException("Image materialization cancelled.", "AbortError");
        try {
          activeRequests += 1;
          let response;
          try {
            const pendingResponse = fetcher(entry.normalizedUrl, { credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer", signal: options.signal });
            options.onRequestStart?.({ index, total: entries.length, attempt, activeRequests, maximumConcurrency: concurrency });
            response = await pendingResponse;
          } finally {
            activeRequests -= 1;
          }
          if (response && response.status >= 200 && response.status < 300) return { response, attempts: attempt };
          const status = response?.status ?? "UNKNOWN";
          const error = new Error(`HTTP_${status}`);
          error.retryable = status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599);
          throw error;
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          lastError = error;
          const retryable = error?.retryable === true || error instanceof TypeError;
          if (!retryable || attempt >= maximumAttempts) {
            error.attempts = attempt;
            throw error;
          }
          await sleep(jitter(minimumRetryDelay, maximumRetryDelay));
        }
      }
      throw lastError ?? new Error("FETCH_FAILED");
    }

    async function materializeOne(index) {
      if (options.signal?.aborted) throw new DOMException("Image materialization cancelled.", "AbortError");
      const entry = entries[index];
      const sourceImageKeys = Array.isArray(entry.sourceImageKeys) && entry.sourceImageKeys.length ? [...new Set(entry.sourceImageKeys)].sort() : [entry.imageKey];
      let receipt;
      let attempts = 1;
      try {
        const fetched = await fetchWithRetry(entry, index);
        const response = fetched.response;
        attempts = fetched.attempts;
        const finalUrl = normalizeImageUrl(response.url || entry.normalizedUrl, policy.allowedImageHosts);
        const remainingBytes = policy.maximumBytes - downloadedBytes;
        if (remainingBytes < 1) throw new Error("TOTAL_BYTE_LIMIT");
        const bytes = await responseBytes(response, Math.min(policy.maximumBytesPerAsset, remainingBytes));
        if (downloadedBytes + bytes.byteLength > policy.maximumBytes) throw new Error("TOTAL_BYTE_LIMIT");
        downloadedBytes += bytes.byteLength;
        const declaredType = String(response.headers?.get?.("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
        const detectedType = mediaTypeFromMagic(bytes);
        if (!ALLOWED_MEDIA_TYPES.has(declaredType) || declaredType !== detectedType || !policy.allowedMediaTypes.includes(detectedType)) throw new Error("INVALID_MEDIA_TYPE");
        const size = dimensions(bytes, detectedType);
        if (!size || size.width < 1 || size.height < 1 || size.width > policy.maximumWidth || size.height > policy.maximumHeight) throw new Error("INVALID_DIMENSIONS");
        const contentHash = await sha256(bytes);
        const extension = mediaExtension(detectedType);
        const relativePath = `media/${contentHash.slice(0, 2)}/${contentHash}.${extension}`;
        const displayFileName = root.CitizenDataMediaFileNames?.deriveDisplayFileName?.({ title: entry.title, role: entry.references[0]?.role, imageKey: entry.imageKey, sourceUrl: entry.normalizedUrl, mediaType: detectedType }) ?? null;
        if (!filesByPath.has(relativePath)) {
          if (totalBytes + bytes.byteLength > policy.maximumBytes) throw new Error("TOTAL_BYTE_LIMIT");
          totalBytes += bytes.byteLength;
          filesByPath.set(relativePath, { name: relativePath, bytes });
        }
        receipt = { assetId: entry.imageKey, sourceImageKeys, sourceUrl: entry.normalizedUrl, finalUrl, status: "downloaded", relativePath, displayFileName, mediaType: detectedType, byteLength: bytes.byteLength, pixelWidth: size.width, pixelHeight: size.height, contentHash, fetchedAt: now(), attempts, errorCode: null, entityReferences: entry.references };
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        attempts = Number.isSafeInteger(error?.attempts) ? error.attempts : attempts;
        receipt = { assetId: entry.imageKey, sourceImageKeys, sourceUrl: entry.normalizedUrl, finalUrl: null, status: "failed", relativePath: null, displayFileName: null, mediaType: null, byteLength: null, pixelWidth: null, pixelHeight: null, contentHash: null, fetchedAt: null, attempts, errorCode: String(error?.message ?? "FETCH_FAILED").slice(0, 120), entityReferences: entry.references };
      }
      assets[index] = receipt;
      completed += 1;
      options.onProgress?.({ completed, total: entries.length, receipt, activeRequests });
    }

    async function worker() {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= entries.length) return;
        await materializeOne(index);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()));
    const files = [...filesByPath.values()].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    return { assets, files, totalBytes, downloadedBytes };
  }

  return Object.freeze({ collectImageReferences, dimensions, materialize, mediaTypeFromMagic, normalizeImageUrl, plan, responseBytes, sha256 });
});


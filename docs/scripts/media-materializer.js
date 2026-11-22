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

  // The image hosts' earlier runs (§14, criterion 20), in the order given: the extension's image history, then a loaded
  // package's. The first that passes its checks is used; a malformed one is not. The account's history is never one.
  function priorImageHistory(candidates, History, settings) {
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      if (!["extension", "package"].includes(candidate?.source) || !candidate.record) continue;
      if (History.validateImageHistory(candidate.record, settings) === null) return { source: candidate.source, record: candidate.record };
    }
    return null;
  }

  // The image run (PARSER_HARDENING.md §14). The live pace stays in this run: it starts at the controller's slow start,
  // every change of it goes through one queue in the order the answers end, and every start waits for the latest
  // retryNotBefore just before its request. RSI's image errors carry no cross-site header, so a TypeError is told
  // apart from a dead link by asking again for the last image that downloaded: the control image.
  async function materialize(entries, policy, options) {
    if (!Array.isArray(entries) || entries.length > policy.maximumAssets) throw new RangeError("Image plan exceeds the configured asset limit.");
    const fetcher = options?.fetcher;
    if (typeof fetcher !== "function") throw new TypeError("A public-image transport is required.");
    const settings = options.settings ?? root.CITIZENDATA_REQUEST_PACING;
    const Pace = options.paceController ?? root.CitizenDataPaceController;
    const History = options.paceHistory ?? root.CitizenDataPaceHistory;
    if (!settings?.images || !settings.brakes || !Pace || !History) throw new TypeError("The request pacing settings, the pace controller and the pace history must load before the image run.");
    const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const now = options.now ?? (() => new Date().toISOString());
    const nowMs = options.nowMs ?? (() => Date.now());
    const random = options.random ?? Math.random;
    // The settings' validator bounds these values, so the value in the settings file is the value used.
    const gapBaseline = { startGapMinimumMs: policy.minimumInterRequestDelayMs, startGapMaximumMs: policy.maximumInterRequestDelayMs };
    const concurrency = policy.maximumConcurrency;
    const maximumAttempts = policy.maximumAttempts;
    const minimumRetryDelay = policy.minimumRetryDelayMs;
    const maximumRetryDelay = policy.maximumRetryDelayMs;
    const controlReuseMs = settings.images.controlImageReuseMs;
    const maximumRefused = settings.images.maximumRefusedAttemptsPerImage;
    const maxFactor = Pace.maximumFactor(Math.max(1, gapBaseline.startGapMinimumMs), settings);
    // Every image and control request reserves one count of this bound before it is sent (§14).
    const maximumActualRequests = entries.length * (maximumAttempts + maximumRefused + 1);
    const IMAGE_FAMILY = Pace.requestFamily("images", "GET", "/{image}");
    const assets = new Array(entries.length);
    const filesByPath = new Map();
    const perImage = entries.map(() => ({ attempts: 0, refused: 0, redirects: 0 }));
    const queue = entries.map((_, index) => index);
    let waiters = [];
    let totalBytes = 0;
    let downloadedBytes = 0;
    let completed = 0;
    let starts = 0;
    let activeRequests = 0;
    let actualRequests = 0;
    let refusedAttempts = 0;
    let startGate = Promise.resolve();
    let stopping = false;
    let stoppedWithRemaining = false;
    let lastDownloadedUrl = null;
    let typeErrorsWithoutDownload = 0;
    let control = null;
    let requestSequence = 0;
    let refusalBatchSequence = 0;
    let controlSequence = 0;
    const openImageRequests = new Set();
    const refusalBatchByRequest = new Map();
    const refusalActions = new Map();
    // The live pace and the run's pace summary (§4.7), changed only through paceMutationQueue.
    let pace = options.initialPace ? { ...options.initialPace } : Pace.initialPace(settings);
    const fingerprint = typeof options.settingsFingerprint === "string" ? options.settingsFingerprint
      : typeof root.CitizenDataRequestPacing?.settingsFingerprint === "function" ? await root.CitizenDataRequestPacing.settingsFingerprint(settings) : null;
    let history = History.startRun({ runId: options.runId ?? "images", accountId: options.accountId ?? "images", runKind: "images", settingsFingerprint: fingerprint, settingsVersion: settings.version, startedAt: now(), startedFactor: pace.factor });
    // The image family's normal response times come from the earlier image runs; they never set the starting factor or
    // any live penalty, which start from the settings alone.
    const prior = priorImageHistory(options.history, History, settings);
    const historicalNormal = prior ? History.imageNormalLatency(prior.record, IMAGE_FAMILY, settings) : [];
    let paceMutationQueue = Promise.resolve();

    function mutate(transition) {
      const next = paceMutationQueue.then(transition);
      paceMutationQueue = next.catch(() => {});
      return next;
    }

    // What every progress value carries of the pace: bounded, with no RSI message.
    function paceView() {
      const until = Date.parse(pace.retryNotBefore);
      const statusPage = typeof options.statusPage === "function" ? options.statusPage() ?? null : null;
      return Object.freeze({ warning: ["limited", "slow"].includes(pace.warning) ? pace.warning : null, waitingUntil: Number.isFinite(until) && until > nowMs() ? pace.retryNotBefore : null, factor: Math.round(pace.factor * 1000) / 1000, statusPage });
    }

    function report(receipt = null) {
      options.onProgress?.({ completed, total: entries.length, receipt, activeRequests, pace: paceView() });
    }

    function jitter(minimum, maximum) {
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum) throw new TypeError("Invalid image request delay policy.");
      return Math.round(minimum + (maximum - minimum) * Math.max(0, Math.min(1, random())));
    }

    function aborted() {
      if (options.signal?.aborted) throw new DOMException("Image materialization cancelled.", "AbortError");
    }

    // One start at a time: the gap at the current factor, then the latest wait, read again after every sleep.
    async function waitForStartSlot() {
      const previous = startGate;
      let release;
      startGate = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        if (starts > 0) await sleep(Pace.startGapMs({ baseline: gapBaseline, pace, settings, random }));
        for (;;) {
          await paceMutationQueue;
          const until = Date.parse(pace.retryNotBefore);
          const wait = Number.isFinite(until) ? until - nowMs() : 0;
          if (wait <= 0 || stopping || options.signal?.aborted) break;
          await sleep(wait);
        }
        starts += 1;
      } finally {
        release();
      }
    }

    function reserve() {
      if (actualRequests >= maximumActualRequests) return false;
      actualRequests += 1;
      return true;
    }

    async function send(url, index, attempt, extra = {}) {
      const requestId = index >= 0 ? ++requestSequence : null;
      if (requestId !== null) openImageRequests.add(requestId);
      activeRequests += 1;
      const startedAt = nowMs();
      try {
        const pending = fetcher(url, { credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer", signal: options.signal, ...extra });
        options.onRequestStart?.({ index, total: entries.length, attempt, activeRequests, maximumConcurrency: concurrency, control: extra.cache === "no-store" });
        return { response: await pending, error: null, elapsedMs: Math.max(0, nowMs() - startedAt), requestId };
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        return { response: null, error, elapsedMs: Math.max(0, nowMs() - startedAt), requestId };
      } finally {
        activeRequests -= 1;
      }
    }

    // The requests already in flight when the first refusal lands are one concurrent batch. Later starts are not
    // added. Every refused answer is retained, but the batch changes the controller only once.
    function refusalBatchFor(requestId) {
      const existing = refusalBatchByRequest.get(requestId);
      if (existing) return existing;
      const batchId = `images:${++refusalBatchSequence}`;
      const members = openImageRequests.has(requestId) ? [...openImageRequests] : [requestId];
      for (const member of members) if (!refusalBatchByRequest.has(member)) refusalBatchByRequest.set(member, batchId);
      return batchId;
    }

    function finishImageRequest(requestId) {
      if (requestId === null) return;
      openImageRequests.delete(requestId);
      const batchId = refusalBatchByRequest.get(requestId);
      refusalBatchByRequest.delete(requestId);
      if (batchId && ![...refusalBatchByRequest.values()].includes(batchId)) refusalActions.delete(batchId);
    }

    function responseRetryAfterMs(response) {
      const bound = (milliseconds) => Math.min(24 * 60 * 60 * 1000, Math.max(0, milliseconds));
      const value = response?.headers?.get?.("retry-after");
      if (typeof value !== "string" || value.trim() === "") return null;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) return bound(Math.round(seconds * 1000));
      const at = Date.parse(value);
      return Number.isFinite(at) ? bound(at - nowMs()) : null;
    }

    // The control image: one request serves every failure in the reuse time after it.
    async function controlAnswers() {
      if (control && nowMs() - control.startedAtMs < controlReuseMs) return control.answered;
      const startedAtMs = nowMs();
      const batchId = `control:${++controlSequence}`;
      const answered = (async () => {
        await waitForStartSlot();
        aborted();
        if (stopping || !reserve()) return { ok: false, batchId };
        const { response, elapsedMs } = await send(lastDownloadedUrl, -1, 1, { cache: "no-store" });
        const ok = Boolean(response && response.status >= 200 && response.status < 300);
        await mutate(() => {
          history = History.recordAttempt(history, { section: "images", requestFamily: IMAGE_FAMILY, outcome: ok ? "accepted" : "limit", code: ok ? "OK" : "IMAGE_CONTROL_FAILED", httpStatus: response?.status ?? null, elapsedMs, factor: pace.factor, retried: false }, settings);
        });
        return { ok, batchId };
      })();
      control = { startedAtMs, answered };
      return answered;
    }

    // A refused attempt (§14): onRefusal, a wait no start passes, and the image back in the queue.
    async function refused(code, httpStatus, elapsedMs, batchId, retryAfterMs = null) {
      refusedAttempts += 1;
      const signal = { kind: "limit", code, httpStatus, rsiCode: null, rsiMessage: null, retryAfterMs, reason: null, method: "GET", route: null, page: null, elapsedMs, fromCanary: false };
      const action = await mutate(() => {
        let batchAction = refusalActions.get(batchId);
        if (!batchAction) {
          const result = Pace.onRefusal(pace, signal, { nowMs: nowMs(), random, settings, maxFactor, expiresAtMs: Number.POSITIVE_INFINITY });
          pace = result.pace;
          batchAction = result.action;
          refusalActions.set(batchId, batchAction);
        } else if (Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0) {
          const stronger = nowMs() + retryAfterMs;
          if (stronger > Date.parse(pace.retryNotBefore)) pace = { ...pace, retryNotBefore: new Date(stronger).toISOString() };
        }
        history = History.recordAttempt(history, { section: "images", requestFamily: IMAGE_FAMILY, outcome: "limit", code, httpStatus, elapsedMs, factor: pace.factor, retried: false }, settings);
        return batchAction;
      });
      report();
      return action;
    }

    function failedReceipt(entry, sourceImageKeys, attempts, errorCode) {
      return { assetId: entry.imageKey, sourceImageKeys, sourceUrl: entry.normalizedUrl, finalUrl: null, status: "failed", relativePath: null, displayFileName: null, mediaType: null, byteLength: null, pixelWidth: null, pixelHeight: null, contentHash: null, fetchedAt: null, attempts, errorCode: String(errorCode ?? "FETCH_FAILED").slice(0, 120), entityReferences: entry.references };
    }

    // One image until it downloads, fails, goes back in the queue, or the run stops.
    async function fetchImage(entry, index) {
      const own = perImage[index];
      for (;;) {
        aborted();
        if (stopping) return { stop: "RATE_LIMITED" };
        await waitForStartSlot();
        aborted();
        if (stopping) return { stop: "RATE_LIMITED" };
        if (!reserve()) {
          stopping = true;
          stoppedWithRemaining = true;
          return { stop: "RATE_LIMITED" };
        }
        own.attempts += 1;
        const { response, error, elapsedMs, requestId } = await send(entry.normalizedUrl, index, own.attempts);
        try {
          const status = response?.status;
          if (response && status >= 200 && status < 300) {
            await mutate(() => {
              pace = Pace.onSuccess(pace, { requestFamily: IMAGE_FAMILY, elapsedMs, historicalNormal: historicalNormal.length > 0 ? historicalNormal : null, nowMs: nowMs(), settings, maxFactor });
              history = History.recordAttempt(history, { section: "images", requestFamily: IMAGE_FAMILY, outcome: "accepted", code: "OK", httpStatus: status, elapsedMs, factor: pace.factor, retried: own.attempts > 1 }, settings);
            // The whole response time joins the image family's retained times, for the next image run (§6.8, §14).
              history = History.recordAccepted(history, { requestFamily: IMAGE_FAMILY, elapsedMs, factor: pace.factor }, settings);
              history = History.recordStep(history, { factor: pace.factor, slow: pace.warning === "slow" });
            });
            lastDownloadedUrl = entry.normalizedUrl;
            typeErrorsWithoutDownload = 0;
            return { response, attempts: own.attempts };
          }
        // A visible limit, or a TypeError the control image confirms, is a refusal; it does not count as an attempt.
          let refusal = null;
          let batchId = refusalBatchFor(requestId);
          if (response && [429, 502, 503, 504].includes(status)) refusal = `IMAGE_HTTP_${status}`;
          else if (error?.name === "TypeError") {
            if (lastDownloadedUrl === null) {
              typeErrorsWithoutDownload += 1;
              if (typeErrorsWithoutDownload >= 3) refusal = "IMAGE_NETWORK_REFUSED";
            } else {
              const controlResult = await controlAnswers();
              if (!controlResult.ok) {
                refusal = "IMAGE_CONTROL_FAILED";
                batchId = controlResult.batchId;
              }
            }
          }
          if (refusal) {
            own.attempts -= 1;
            own.refused += 1;
            const action = await refused(refusal, Number.isInteger(status) ? status : null, elapsedMs, batchId, responseRetryAfterMs(response));
            if (action === "give-up") {
              stopping = true;
              stoppedWithRemaining = true;
              return { stop: "RATE_LIMITED" };
            }
            if (own.refused >= maximumRefused) return { failed: "RATE_LIMITED", attempts: own.attempts };
            return { requeue: true };
          }
        // A redirect is not a refusal: the second for the same image records it failed.
          const redirected = Boolean(response) && status === 0;
          if (redirected) own.redirects += 1;
          const redirect = redirected && own.redirects < 2;
          const retryable = redirect || (Number.isInteger(status) && status >= 500 && status <= 599) || error?.name === "TypeError";
          if (!retryable || own.attempts >= maximumAttempts) return { failed: error ? error.message : `HTTP_${status ?? "UNKNOWN"}`, attempts: own.attempts };
          await sleep(jitter(minimumRetryDelay, maximumRetryDelay));
        } finally {
          finishImageRequest(requestId);
        }
      }
    }

    async function materializeOne(index) {
      aborted();
      const entry = entries[index];
      const sourceImageKeys = Array.isArray(entry.sourceImageKeys) && entry.sourceImageKeys.length ? [...new Set(entry.sourceImageKeys)].sort() : [entry.imageKey];
      let receipt;
      try {
        const fetched = await fetchImage(entry, index);
        if (fetched.requeue) {
          queue.push(index);
          wake();
          return;
        }
        if (fetched.stop || fetched.failed) {
          receipt = failedReceipt(entry, sourceImageKeys, fetched.attempts ?? perImage[index].attempts, fetched.stop ?? fetched.failed);
        } else {
          const response = fetched.response;
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
          receipt = { assetId: entry.imageKey, sourceImageKeys, sourceUrl: entry.normalizedUrl, finalUrl, status: "downloaded", relativePath, displayFileName, mediaType: detectedType, byteLength: bytes.byteLength, pixelWidth: size.width, pixelHeight: size.height, contentHash, fetchedAt: now(), attempts: fetched.attempts, errorCode: null, entityReferences: entry.references };
        }
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        receipt = failedReceipt(entry, sourceImageKeys, perImage[index].attempts, error?.message);
      }
      assets[index] = receipt;
      completed += 1;
      wake();
      report(receipt);
    }

    // Workers take the next image from the queue; an image a refusal put back is taken again later.
    function wake() {
      const waiting = waiters;
      waiters = [];
      for (const resolve of waiting) resolve();
    }

    async function worker() {
      while (completed < entries.length) {
        const index = queue.shift();
        if (index === undefined) {
          await new Promise((resolve) => { waiters.push(resolve); });
          continue;
        }
        await materializeOne(index);
      }
      wake();
    }

    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()));
    } finally {
      wake();
    }
    await paceMutationQueue;
    const files = [...filesByPath.values()].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const pacing = typeof fingerprint === "string" && /^[a-f0-9]{64}$/u.test(fingerprint) ? History.runSummary(history) : null;
    // The run's record for the extension's image history, and the receipt's provenance: the history's source, what it
    // held before, the samples the controller was given, and the history with this run in it, as one aggregate.
    const imageRun = pacing ? { ...history, endedAt: now() } : null;
    const paceHistory = imageRun ? {
      source: prior?.source ?? "none",
      priorAggregate: prior ? History.imagePriorCounts(prior.record, settings) : null,
      acceptedSamples: [...historicalNormal],
      aggregate: History.imageAggregate(History.finishImageRun(prior?.record ?? null, imageRun, { endedAt: imageRun.endedAt }, settings), settings)
    } : null;
    return { assets, files, totalBytes, downloadedBytes, stoppedWithRemaining, refusedAttempts, actualRequests, pace: paceView(), pacing, paceHistory, imageRun };
  }

  return Object.freeze({ collectImageReferences, dimensions, materialize, mediaTypeFromMagic, normalizeImageUrl, plan, responseBytes, sha256 });
});

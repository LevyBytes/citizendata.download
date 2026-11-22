(function initializeCitizenDataRsiStatusPage(root, factory) {
  "use strict";

  const api = factory(root.CITIZENDATA_REQUEST_PACING);
  root.CitizenDataRsiStatusPage = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataRsiStatusPage(pacing) {
  "use strict";

  // RSI's status page (PARSER_HARDENING.md §9.3). Its JSON feed is a static file RSI's staff rebuild when they post to
  // it: "operational" means RSI has posted no problem, not that RSI is working. One address is read, the settings'
  // constant, without cookies; no address comes from outside and no HTML is parsed.
  const SETTINGS = pacing.smartCheck;
  const FEED_URL = SETTINGS.statusFeedUrl;
  // The optional host permission the feed needs (§9.3, D14).
  const STATUS_ORIGIN_PATTERN = `${new URL(FEED_URL).origin}/*`;
  const MAXIMUM_COMPONENTS = 10;
  const NAME_LIMIT = 60;
  const STATE_LIMIT = 20;

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // Text the result may carry: printable characters only, at most `limit` of them.
  function printable(value, limit) {
    return [...String(value)].filter((character) => character >= " " && character !== "\u007f").join("").slice(0, limit);
  }

  // A 200 JSON feed of the recorded shape: "ok", or "issue" with each affected system once. Null for any other shape.
  function readFeed(feed) {
    if (!isRecord(feed) || typeof feed.summaryStatus !== "string" || !Array.isArray(feed.systems) || feed.systems.length === 0) return null;
    const known = feed.systems.every((system) => isRecord(system) && typeof system.name === "string" && typeof system.status === "string" && Array.isArray(system.unresolvedIssues));
    if (!known) return null;
    const components = [];
    for (const system of feed.systems) {
      if (system.status === "operational" && system.unresolvedIssues.length === 0) continue;
      const name = printable(system.name, NAME_LIMIT);
      if (components.some((component) => component.name === name)) continue;
      components.push({ name, state: printable(system.status === "operational" ? "unresolved issue" : system.status, STATE_LIMIT) });
    }
    if (feed.summaryStatus === "operational" && components.length === 0) return { status: "ok", components: [] };
    // A summary that is not operational while no system says why still names what the feed reports.
    if (components.length === 0) components.push({ name: "RSI status", state: printable(feed.summaryStatus, STATE_LIMIT) });
    return { status: "issue", components: components.slice(0, MAXIMUM_COMPONENTS) };
  }

  // One answer of the feed. Anything but a 200 JSON answer of the recorded shape is unreadable, never "ok".
  async function classifyAnswer(response) {
    const unreadable = { status: "unknown", reason: "unreadable", components: [], httpStatus: Number.isSafeInteger(response?.status) ? response.status : null };
    const contentType = String(response?.headers?.get?.("content-type") ?? "");
    if (response?.status !== 200 || !/^application\/json(?:;|$)/iu.test(contentType.trim())) return unreadable;
    let feed;
    try {
      feed = JSON.parse(await response.text());
    } catch {
      return unreadable;
    }
    const read = readFeed(feed);
    return read ? { ...read, reason: null, httpStatus: 200 } : unreadable;
  }

  // What a caller is told: the status, its reason, the components, the answer's HTTP status and when it was read.
  function publicResult(record) {
    return { status: record.status, reason: record.reason ?? null, components: record.components.map((component) => ({ ...component })), httpStatus: record.httpStatus ?? null, checkedAt: record.checkedAt };
  }

  // How often a caller that found another caller's lease looks for its result in the durable cache.
  const LEASE_POLL_MS = 250;

  // Makes the checker a worker uses. The durable cache is read before any permission or fetch work. A request needs the
  // durable lease (`cache.reserve`), taken in one transaction, so at most one request goes out per cache period across
  // workers, restarts and concurrent callers; callers of one worker share its read. The cache keeps a result only when it
  // is newer than the stored one, and the result releases the lease.
  function createChecker({ fetcher, hasPermission, cache, nowMs = () => Date.now(), wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) {
    let inFlight = null;
    const unknown = (reason) => ({ status: "unknown", reason, components: [], httpStatus: null, checkedAt: new Date(nowMs()).toISOString() });

    async function read(leaseId) {
      const requestedAt = new Date(nowMs()).toISOString();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SETTINGS.statusTimeoutMs);
      let result;
      try {
        const response = await fetcher(FEED_URL, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
        result = await classifyAnswer(response);
      } catch {
        // A request that failed or gave up is unreadable.
        result = { status: "unknown", reason: "unreadable", components: [], httpStatus: null };
      } finally {
        clearTimeout(timer);
      }
      const checkedMs = nowMs();
      const record = { ...result, requestedAt, checkedAt: new Date(checkedMs).toISOString(), expiresAt: new Date(checkedMs + SETTINGS.statusPageCacheMs).toISOString() };
      return publicResult(await cache.put(record, leaseId) ?? record);
    }

    // Another caller holds the lease: its result is looked for in the durable cache until shortly before the status
    // timeout. An expired record is never presented as current; without a fresh result, the feed counts as not read.
    async function leaseHolderResult() {
      const deadline = nowMs() + SETTINGS.statusTimeoutMs - 2 * LEASE_POLL_MS;
      for (;;) {
        const cached = await cache.get();
        if (cached && Date.parse(cached.expiresAt) > nowMs()) return publicResult(cached);
        if (nowMs() >= deadline) return unknown("unreadable");
        await wait(LEASE_POLL_MS);
      }
    }

    async function reserveAndRead(options = {}) {
      if (!await hasPermission()) return unknown("no-permission");
      if (typeof cache.reserve !== "function") return read(null);
      const leaseId = globalThis.crypto.randomUUID();
      const reservation = await cache.reserve({ nowMs: nowMs(), leaseMs: SETTINGS.statusPageCacheMs, leaseId });
      if (reservation.action === "cached") return publicResult(reservation.record);
      if (reservation.action === "pending") return leaseHolderResult();
      if (typeof options.beforeRequest === "function") {
        let allowed;
        try { allowed = await options.beforeRequest() === true; } catch { allowed = false; }
        if (!allowed) {
          await cache.release?.(leaseId);
          return unknown("unreadable");
        }
      }
      return read(leaseId);
    }

    async function checkStatusPage(options = {}) {
      const cached = await cache.get();
      if (cached && Date.parse(cached.expiresAt) > nowMs()) return publicResult(cached);
      inFlight ??= reserveAndRead(options).finally(() => {
        inFlight = null;
      });
      return inFlight;
    }

    return Object.freeze({ checkStatusPage });
  }

  // The worker's checker, set once it has its repository; until then, the status page counts as not read.
  let configured = null;
  function configure(options) {
    configured = createChecker(options);
  }
  function checkStatusPage(options = {}) {
    return configured ? configured.checkStatusPage(options) : Promise.resolve({ status: "unknown", reason: "unreadable", components: [], httpStatus: null, checkedAt: new Date().toISOString() });
  }

  return Object.freeze({ FEED_URL, STATUS_ORIGIN_PATTERN, MAXIMUM_COMPONENTS, readFeed, classifyAnswer, createChecker, configure, checkStatusPage });
});

// The pace controller: how much slower than the fastest baseline a run sends its requests to RSI, and how that changes
// as RSI accepts, refuses or answers slowly (PARSER_HARDENING.md §6).
//
// `npm run sync:schemas` copies this file byte for byte to extension/shared/pace-controller.js and
// docs/scripts/pace-controller.js. The account build and the roster run use it in the extension's runner, the image run
// in the dashboard. It is pure: time, randomness and the settings are passed in, and every function returns a new
// state without changing the one it was given.
//
// The factor is how many times slower than the fastest baseline a run goes: 1 is the fastest baseline, 2 is "100%
// slower". Every run starts at 2 and speeds up while RSI accepts its requests.
(function exposePaceController(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataPaceController = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  // The layout of a stored pace state. A change of layout changes this number.
  const CONTROLLER_VERSION = 1;

  const iso = (ms) => new Date(ms).toISOString();
  const step = (percent) => 1 + percent / 100;
  const unit = (random) => Math.max(0, Math.min(1, random()));
  // The element at index floor(length / 2) of the sorted list.
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

  // A run's first pace: the slow start of rule 1, with no penalty state.
  function initialPace(settings) {
    return { version: 1, factor: step(settings.brakes.startSlowerPercent), goodSince: null, periodsUsed: 0,
      wall: null, belowWallAt: null, retestAfterMs: settings.brakes.retestFirstMs, retestAt: null, attempt: 0,
      refusingSince: null, retryNotBefore: null, lastRefusalAt: null, freeRetryAt: null, canaryDue: false,
      warning: null, lastSignal: null, statusPage: null, latency: { byRequestFamily: {} } };
  }

  // The first 5 and the last 5 accepted answers' times of one request family.
  function recordLatency(latency, requestFamily, elapsedMs) {
    const entry = latency.byRequestFamily[requestFamily] ?? { first: [], recent: [] };
    const first = entry.first.length < 5 ? [...entry.first, elapsedMs] : entry.first;
    return { byRequestFamily: { ...latency.byRequestFamily, [requestFamily]: { first, recent: [...entry.recent, elapsedMs].slice(-5) } } };
  }

  // Rule 5: the family's recent answers take over twice their normal time, and over a second.
  function isSlow(latency, requestFamily, b, historicalNormal = null) {
    const entry = latency.byRequestFamily[requestFamily];
    if (!entry || entry.recent.length < 5) return false;
    const normal = Array.isArray(historicalNormal) && historicalNormal.length >= 5 ? median(historicalNormal) : entry.first.length >= 5 ? median(entry.first) : null;
    if (normal === null) return false;
    const recent = median(entry.recent);
    return recent > b.latencyRatio * normal && recent > b.latencyMinimumMs;
  }

  // A stored step: rules 2, 4 and 5.
  function onSuccess(pace, { requestFamily, elapsedMs, historicalNormal, nowMs, settings, maxFactor }) {
    const b = settings.brakes;
    let next = { ...pace, attempt: 0, refusingSince: null, freeRetryAt: null, canaryDue: false, latency: recordLatency(pace.latency, requestFamily, elapsedMs) };
    if (next.goodSince === null) next = { ...next, goodSince: iso(nowMs), periodsUsed: 0 };
    const periods = Math.floor((nowMs - Date.parse(next.goodSince)) / b.speedUpEveryMs);
    const due = periods - next.periodsUsed;
    const slow = isSlow(next.latency, requestFamily, b, historicalNormal);
    next = { ...next, periodsUsed: Math.max(next.periodsUsed, periods), warning: next.warning === "limited" ? "limited" : slow ? "slow" : null };
    if (due <= 0) return next;
    if (slow) {
      const cap = step(b.latencyBrakeMaximumPercent);
      return { ...next, factor: next.factor >= cap ? next.factor : Math.min(cap, next.factor * step(b.speedUpPercent) ** due) };
    }
    if (next.wall !== null && next.belowWallAt !== null && nowMs - Date.parse(next.belowWallAt) >= b.speedUpEveryMs) {
      next = { ...next, wall: null, belowWallAt: null, retestAt: null, retestAfterMs: b.retestFirstMs, warning: null };   // the re-test passed
    }
    const holding = next.wall !== null && nowMs < Date.parse(next.retestAt);
    const floor = holding ? Math.min(maxFactor, next.wall * step(b.wallMarginPercent)) : 1;   // never past the longest interval
    let factor = Math.max(1, floor, next.factor / step(b.speedUpPercent) ** due);
    if (factor < 1.02) factor = 1;
    const belowWallAt = next.wall !== null && factor < next.wall ? (next.belowWallAt ?? iso(nowMs)) : null;
    return { ...next, factor, belowWallAt };
  }

  // Rule 8. Returns null when the signal is a refusal; the caller then calls onRefusal.
  function freeRetry(pace, signal, { nowMs, random, settings }) {
    const b = settings.brakes;
    const soft = signal.kind === "transient" || signal.code === "RSI_NETWORK_OR_REDIRECT";
    const quiet = pace.lastRefusalAt === null || nowMs - Date.parse(pace.lastRefusalAt) >= b.freeRetryQuietMs;
    if (!soft || !quiet || pace.refusingSince !== null || pace.freeRetryAt !== null) return null;
    const wait = waitMs(0, signal, b, random);
    return { pace: { ...pace, freeRetryAt: iso(nowMs), retryNotBefore: iso(nowMs + wait), lastSignal: signal }, waitMs: wait };
  }

  // A refused attempt: rules 3, 6 and 7, and the run's lifetime.
  function onRefusal(pace, signal, { nowMs, random, settings, maxFactor, expiresAtMs }) {
    const b = settings.brakes;
    const retesting = pace.wall !== null && pace.factor < pace.wall;
    const retestAfterMs = retesting ? Math.min(b.retestMaximumMs, pace.retestAfterMs * 2) : pace.retestAfterMs;
    const refusingSince = pace.refusingSince ?? iso(nowMs);
    const wait = waitMs(pace.attempt, signal, b, random);
    const next = {
      ...pace,
      factor: Math.min(maxFactor, pace.factor * step(b.slowDownPercent)),
      wall: pace.factor, belowWallAt: null, retestAfterMs, retestAt: iso(nowMs + retestAfterMs),
      goodSince: null, periodsUsed: 0, attempt: pace.attempt + 1, refusingSince,
      lastRefusalAt: signal.kind === "limit" || signal.kind === "transient" ? iso(nowMs) : pace.lastRefusalAt,
      retryNotBefore: iso(nowMs + wait), canaryDue: signal.kind === "ambiguous", warning: "limited", lastSignal: signal
    };
    const refusingFor = nowMs + wait - Date.parse(refusingSince);
    const action = refusingFor > b.giveUpAfterRefusingMs ? "give-up"
      : nowMs + wait > expiresAtMs - b.lifetimeMarginMs ? "lifetime"
      : "wait";
    return { pace: next, waitMs: wait, action };
  }

  // Rule 6: equal jitter on 5 s, 10 s, 20 s ... 5 min, never shorter than Retry-After.
  function waitMs(attempt, signal, b, random) {
    const ceiling = Math.min(b.maximumWaitMs, b.firstWaitMs * 2 ** attempt);
    const backoff = Math.round(ceiling / 2 + unit(random) * (ceiling / 2));   // equal jitter
    return Math.max(backoff, signal.retryAfterMs ?? 0);
  }

  // The time from one step's start to the next (§6.3). At factor 1 it is today's interval and jitter.
  function stepIntervalMs({ baseline, planFloorMs, pace, settings, random }) {
    const effective = Math.max(planFloorMs, baseline.intervalMs);
    const interval = Math.min(settings.brakes.maximumIntervalMs, Math.round(effective * Math.max(1, pace.factor)));
    const u = Math.max(0, Math.min(1, random()));
    if (interval === baseline.intervalMs && Number.isSafeInteger(baseline.jitterMs)) {
      return interval + Math.min(baseline.jitterMs, Math.floor((baseline.jitterMs + 1) * u));   // today's 900 ms rule
    }
    const percent = interval === baseline.intervalMs ? baseline.jitterPercent : settings.brakes.slowedJitterPercent;
    return interval + Math.floor(Math.floor((interval * percent) / 100) * u);                   // today's rule for any other interval
  }

  // The image run's gap between two image starts (§14).
  function startGapMs({ baseline, pace, settings, random }) {
    const cap = settings.brakes.maximumIntervalMs;
    const factor = Math.max(1, pace.factor);
    const low = Math.min(cap, Math.round(baseline.startGapMinimumMs * factor));
    const high = Math.min(cap, Math.round(baseline.startGapMaximumMs * factor));
    return low + Math.floor((high - low) * unit(random));
  }

  // Resume: time spent paused never counts as good time.
  const onResume = (pace) => ({ ...pace, goodSince: null, periodsUsed: 0 });
  // For tests that assert today's schedule.
  const atBaseline = (settings) => ({ ...initialPace(settings), factor: 1 });

  // The request family of one request: its section, its method and its fixed route, as rule 5 names them.
  function requestFamily(section, method, route) {
    return `${method} ${route} in ${section}`;
  }

  // The largest factor of a baseline (rule 3): the longest interval divided by the baseline's own, effective one.
  function maximumFactor(effectiveBaselineMs, settings) {
    return settings.brakes.maximumIntervalMs / effectiveBaselineMs;
  }

  // The largest factor any baseline of these settings can reach; a stored factor above it cannot be this run's.
  function largestFactorOf(settings) {
    const intervals = [
      ...Object.values(settings.accountBuild.sections).map((section) => section.intervalMs),
      settings.organizationRosters.intervalMs,
      settings.images.startGapMaximumMs
    ];
    return maximumFactor(Math.min(...intervals), settings);
  }

  // The checks of a stored pace state (§6.2). Each returns null, or the message of the first rule that fails.
  const KINDS = Object.freeze(["limit", "transient", "ambiguous", "user", "contract"]);
  const REASONS = Object.freeze(["signed-out", "account-changed", "check-in-browser"]);
  const SIGNAL_KEYS = Object.freeze(["kind", "code", "httpStatus", "rsiCode", "rsiMessage", "retryAfterMs", "reason", "method", "route", "page", "elapsedMs", "fromCanary"]);
  const PACE_KEYS = Object.freeze(["version", "factor", "goodSince", "periodsUsed", "wall", "belowWallAt", "retestAfterMs", "retestAt", "attempt", "refusingSince", "retryNotBefore", "lastRefusalAt", "freeRetryAt", "canaryDue", "warning", "lastSignal", "statusPage", "latency"]);
  const PENDING_STEP_KEYS = Object.freeze(["version", "section", "attemptId", "phase", "nextRequestAt", "logicalIntervalMs", "logicalStaggerMs", "requestsStarted", "requestsFinished"]);
  const SIGNAL_CODE = /^[A-Z0-9_]{1,80}$/u;
  const RSI_CODE = /^[A-Za-z0-9_-]{1,64}$/u;
  const ROUTE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,200}$/u;
  const NAME = /^[A-Za-z0-9._:/-]{1,120}$/u;
  // A request family (rule 5): the method, the fixed route template and the section, as "POST /route in section". The
  // section comes last, so no family name ends with a route such as setAuthToken, which a backup check reads as a secret.
  const REQUEST_FAMILY = /^(?:GET|POST) \/[A-Za-z0-9._~!$&'()*+,;=:@%/{}-]{0,200} in [A-Za-z0-9._-]{1,80}$/u;
  // Every counter of a stored state stays below this; no real run comes near it.
  const COUNTER_LIMIT = 10000000;
  // Request families one run can name: sections times their few fixed routes, with room to spare.
  const MAXIMUM_REQUEST_FAMILIES = 64;
  // The longest response time kept; a request that took longer had timed out long before.
  const MAXIMUM_ELAPSED_MS = 600000;
  const MESSAGE_LENGTH = 160;

  function isObject(value) {
    // A plain object of any realm: its prototype is an Object.prototype, or it has none.
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  }

  function exactKeys(value, keys, name) {
    if (!isObject(value)) return `${name} must be an object.`;
    for (const key of keys) if (!Object.hasOwn(value, key)) return `${name}.${key} is missing.`;
    for (const key of Object.keys(value)) if (!keys.includes(key)) return `${name}.${key} is not known.`;
    return null;
  }

  // An ISO time as Date#toISOString writes it, or null when allowed.
  function checkTime(value, name, nullable = true) {
    if (value === null && nullable) return null;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) return `${name} must be an ISO time${nullable ? " or null" : ""}.`;
    return null;
  }

  function checkCount(value, name, minimum = 0, maximum = COUNTER_LIMIT) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? null : `${name} must be a whole number from ${minimum} to ${maximum}.`;
  }

  function checkFactor(value, name, largest) {
    return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= largest ? null : `${name} must be a number from 1 to ${largest}.`;
  }

  function nullableCount(value, minimum = 0) {
    return value === null || Number.isSafeInteger(value) && value >= minimum;
  }

  // A character from U+0000 to U+001F or from U+007F to U+009F, which a bounded RSI message never holds.
  function hasControlCharacter(text) {
    for (const character of text) {
      const point = character.codePointAt(0);
      if (point <= 0x1f || point >= 0x7f && point <= 0x9f) return true;
    }
    return false;
  }

  // The last status-page result (§9.3), as extension/adapters/rsi-status-page.js returns it.
  const STATUS_PAGE_KEYS = Object.freeze(["status", "reason", "components", "httpStatus", "checkedAt"]);
  function checkStatusPage(value, name) {
    const keys = exactKeys(value, STATUS_PAGE_KEYS, name);
    if (keys) return keys;
    if (!["ok", "issue", "unknown"].includes(value.status)) return `${name}.status must be ok, issue or unknown.`;
    if (![null, "no-permission", "unreadable"].includes(value.reason)) return `${name}.reason must be no-permission, unreadable or null.`;
    if (!Array.isArray(value.components) || value.components.length > 10) return `${name}.components must be a list of at most 10.`;
    const component = (entry) => exactKeys(entry, ["name", "state"], `${name}.components[]`) === null
      && typeof entry.name === "string" && entry.name.length <= 60 && !hasControlCharacter(entry.name)
      && typeof entry.state === "string" && entry.state.length <= 20 && !hasControlCharacter(entry.state);
    if (!value.components.every(component)) return `${name}.components must hold names of at most 60 and states of at most 20 printable characters.`;
    if (!(value.httpStatus === null || Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)) return `${name}.httpStatus must be an HTTP status or null.`;
    return checkTime(value.checkedAt, `${name}.checkedAt`);
  }

  // The bounded signal of §5.1, as makeSignal of rsi-answer-classification.js writes it.
  function checkSignal(value, name) {
    const keys = exactKeys(value, SIGNAL_KEYS, name);
    if (keys) return keys;
    const rules = [
      ["kind", KINDS.includes(value.kind)],
      ["code", typeof value.code === "string" && SIGNAL_CODE.test(value.code)],
      ["httpStatus", value.httpStatus === null || Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599],
      ["rsiCode", value.rsiCode === null || typeof value.rsiCode === "string" && RSI_CODE.test(value.rsiCode)],
      ["rsiMessage", value.rsiMessage === null || typeof value.rsiMessage === "string" && value.rsiMessage.length <= MESSAGE_LENGTH && !hasControlCharacter(value.rsiMessage)],
      ["retryAfterMs", nullableCount(value.retryAfterMs)],
      ["reason", value.reason === null || value.kind === "user" && REASONS.includes(value.reason)],
      ["method", value.method === null || value.method === "GET" || value.method === "POST"],
      ["route", value.route === null || typeof value.route === "string" && ROUTE.test(value.route)],
      ["page", nullableCount(value.page, 1)],
      ["elapsedMs", nullableCount(value.elapsedMs)],
      ["fromCanary", typeof value.fromCanary === "boolean"]
    ];
    const failed = rules.find(([, passes]) => !passes);
    return failed ? `${name}.${failed[0]} is not a valid signal value.` : null;
  }

  function checkLatency(value, name) {
    const keys = exactKeys(value, ["byRequestFamily"], name);
    if (keys) return keys;
    const families = value.byRequestFamily;
    if (!isObject(families)) return `${name}.byRequestFamily must be an object.`;
    const names = Object.keys(families);
    if (names.length > MAXIMUM_REQUEST_FAMILIES) return `${name}.byRequestFamily holds more than ${MAXIMUM_REQUEST_FAMILIES} request families.`;
    for (const family of names) {
      const label = `${name}.byRequestFamily["${family.slice(0, 40)}"]`;
      if (!REQUEST_FAMILY.test(family)) return `${label} is not a valid request family.`;
      const entryKeys = exactKeys(families[family], ["first", "recent"], label);
      if (entryKeys) return entryKeys;
      for (const list of ["first", "recent"]) {
        const samples = families[family][list];
        if (!Array.isArray(samples) || samples.length > 5 || samples.some((sample) => !Number.isSafeInteger(sample) || sample < 0 || sample > MAXIMUM_ELAPSED_MS)) {
          return `${label}.${list} must hold at most 5 whole response times.`;
        }
      }
    }
    return null;
  }

  // Null when `value` is a pace state this controller can work with, or the message of the first rule that fails.
  function validatePaceState(value, settings) {
    const keys = exactKeys(value, PACE_KEYS, "pace");
    if (keys) return keys;
    if (value.version !== CONTROLLER_VERSION) return `pace.version must be ${CONTROLLER_VERSION}.`;
    const b = settings.brakes;
    const largest = largestFactorOf(settings);
    const checks = [
      () => checkFactor(value.factor, "pace.factor", largest),
      () => checkTime(value.goodSince, "pace.goodSince"),
      () => checkCount(value.periodsUsed, "pace.periodsUsed"),
      () => value.wall === null ? null : checkFactor(value.wall, "pace.wall", largest),
      () => checkTime(value.belowWallAt, "pace.belowWallAt"),
      () => checkCount(value.retestAfterMs, "pace.retestAfterMs", b.retestFirstMs, b.retestMaximumMs),
      () => checkTime(value.retestAt, "pace.retestAt"),
      () => checkCount(value.attempt, "pace.attempt"),
      () => checkTime(value.refusingSince, "pace.refusingSince"),
      () => checkTime(value.retryNotBefore, "pace.retryNotBefore"),
      () => checkTime(value.lastRefusalAt, "pace.lastRefusalAt"),
      () => checkTime(value.freeRetryAt, "pace.freeRetryAt"),
      () => typeof value.canaryDue === "boolean" ? null : "pace.canaryDue must be true or false.",
      () => [null, "limited", "slow"].includes(value.warning) ? null : "pace.warning must be limited, slow or null.",
      () => value.lastSignal === null ? null : checkSignal(value.lastSignal, "pace.lastSignal"),
      () => value.statusPage === null ? null : checkStatusPage(value.statusPage, "pace.statusPage"),
      () => checkLatency(value.latency, "pace.latency"),
      // A held wall always has the time of its re-test.
      () => value.wall !== null && value.retestAt === null ? "pace.retestAt must be set while pace.wall is." : null
    ];
    for (const check of checks) {
      const message = check();
      if (message) return message;
    }
    return null;
  }

  // Null when `value` is a pending request slot of §6.3, or the message of the first rule that fails.
  function validatePendingStep(value, settings) {
    const keys = exactKeys(value, PENDING_STEP_KEYS, "pendingStep");
    if (keys) return keys;
    if (value.version !== 1) return "pendingStep.version must be 1.";
    const checks = [
      () => typeof value.section === "string" && NAME.test(value.section) ? null : "pendingStep.section must be a section id.",
      () => typeof value.attemptId === "string" && NAME.test(value.attemptId) ? null : "pendingStep.attemptId must be an attempt id.",
      () => value.phase === null || typeof value.phase === "string" && /^[a-z][a-z-]{0,39}$/u.test(value.phase) ? null : "pendingStep.phase must be a phase name or null.",
      () => checkTime(value.nextRequestAt, "pendingStep.nextRequestAt", false),
      () => checkCount(value.logicalIntervalMs, "pendingStep.logicalIntervalMs", 0, settings.brakes.maximumIntervalMs * 2),
      () => checkCount(value.logicalStaggerMs, "pendingStep.logicalStaggerMs", 0, settings.brakes.maximumIntervalMs * 2),
      () => checkCount(value.requestsStarted, "pendingStep.requestsStarted"),
      () => checkCount(value.requestsFinished, "pendingStep.requestsFinished", 0, value.requestsStarted)
    ];
    for (const check of checks) {
      const message = check();
      if (message) return message;
    }
    return null;
  }

  return Object.freeze({
    CONTROLLER_VERSION,
    initialPace,
    onSuccess,
    freeRetry,
    onRefusal,
    waitMs,
    stepIntervalMs,
    startGapMs,
    onResume,
    atBaseline,
    requestFamily,
    maximumFactor,
    largestFactorOf,
    validatePaceState,
    validatePendingStep
  });
});

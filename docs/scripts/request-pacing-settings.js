// The request pacing settings: the fastest pace at which the extension and the dashboard send requests to RSI.
//
// This file is the one place the pacing values live. `npm run sync:schemas` copies it byte for byte to
// extension/shared/request-pacing-settings.js and docs/scripts/request-pacing-settings.js; `npm run check:schemas`
// fails while a copy is stale. After a change, run `npm run sync:schemas`, the tests, and the package build.
//
// The baseline values are today's pace, the fastest baseline: no run goes faster. The brakes slow a run down from it
// when RSI refuses or answers slowly, and speed it up again to it. `validateRequestPacingSettings` checks every
// value when the file loads; on a failure the extension declines every run with PACING_SETTINGS_INVALID and the
// dashboard shows the message in the Build Status panel.
(function exposeRequestPacingSettings(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CITIZENDATA_REQUEST_PACING = api.settings;
  root.CitizenDataRequestPacing = api;
})(typeof globalThis === "object" ? globalThis : this, (root) => {
  "use strict";

  const settings = {
    // The layout of this object. A change of layout changes this number.
    version: 1,
    // The account build: one entry for each section of extension/adapters/catalog.js.
    accountBuild: {
      // How long one request to RSI may take before the extension gives up on it: sections, rosters and identify.
      // It ends before Chrome's own 30-second limit for one answer.
      requestTimeoutMs: 25000,
      // A step's second lane starts this share of the step interval after its first; the CCU step's requests are
      // this share of the interval apart.
      staggerPercent: 50,
      // The order in which a build collects the sections. Identity comes first, then Hangar Log.
      sectionOrder: [
        "profile", "hangarLog",
        "financial.balances", "financial.billingTotal", "financial.ledgers", "financial.orders", "financial.subscriptions",
        "pledges", "buybacks",
        "referrals.legacy.recruits", "referrals.current.prospects", "referrals.current.recruits",
        "organizations.memberships", "buybackDetails", "buybackUpgradePrices"
      ],
      // For each section: the time from one step's start to the next, the random addition to it at this pace, and
      // how many requests a step may run side by side.
      sections: {
        // Account identity: the dossier page, then two GraphQL requests.
        "profile": { intervalMs: 900, jitterMs: 200, lanes: 2 },
        // Hangar Log: one or two pages a step.
        "hangarLog": { intervalMs: 900, jitterMs: 200, lanes: 2 },
        // Account balances: one billing page a step.
        "financial.balances": { intervalMs: 900, jitterMs: 200, lanes: 1 },
        // Billing total: one billing page a step.
        "financial.billingTotal": { intervalMs: 900, jitterMs: 200, lanes: 1 },
        // Financial ledgers: one ledger page a step.
        "financial.ledgers": { intervalMs: 900, jitterMs: 200, lanes: 1 },
        // Billing orders: one billing page a step.
        "financial.orders": { intervalMs: 900, jitterMs: 200, lanes: 1 },
        // Subscriptions: one billing page a step.
        "financial.subscriptions": { intervalMs: 900, jitterMs: 200, lanes: 1 },
        // Current Hangar: one or two pledge pages a step.
        "pledges": { intervalMs: 900, jitterMs: 200, lanes: 2 },
        // Buybacks: one or two buy-back pages a step.
        "buybacks": { intervalMs: 900, jitterMs: 200, lanes: 2 },
        // Legacy recruits: one GraphQL request a step.
        "referrals.legacy.recruits": { intervalMs: 900, jitterMs: 200, lanes: 1 },
        // Current prospects: one GraphQL request a step.
        "referrals.current.prospects": { intervalMs: 900, jitterMs: 200, lanes: 1 },
        // Current recruits: one GraphQL request a step.
        "referrals.current.recruits": { intervalMs: 900, jitterMs: 200, lanes: 1 },
        // Organizations: one page a step.
        "organizations.memberships": { intervalMs: 900, jitterMs: 200, lanes: 1 },
        // Buy-back prices: one or two buy-back pages a step.
        "buybackDetails": { intervalMs: 900, jitterMs: 200, lanes: 2 },
        // CCU buy-back prices: one to five requests a step, one after another.
        "buybackUpgradePrices": { intervalMs: 900, jitterMs: 200, lanes: 1 }
      }
    },
    // The organization roster run: one member page a step.
    organizationRosters: {
      // The time from one step's start to the next.
      intervalMs: 10000,
      // The random addition to the interval, as a share of it.
      jitterPercent: 15,
      // Requests a step.
      lanes: 1
    },
    // The image run of the dashboard (docs/scripts/media-materializer.js).
    images: {
      // The shortest time between two image requests' starts.
      startGapMinimumMs: 100,
      // The longest time between two image requests' starts.
      startGapMaximumMs: 200,
      // How many images load at once.
      concurrency: 4,
      // How many times one image is tried.
      attempts: 3,
      // The shortest wait before an image is tried again.
      retryMinimumMs: 750,
      // The longest wait before an image is tried again.
      retryMaximumMs: 1750,
      // One control image request serves every image failure of this long after it.
      controlImageReuseMs: 10000,
      // Refused attempts of one image, beyond its attempts.
      maximumRefusedAttemptsPerImage: 8
    },
    // The start of a run: the identify request that names the signed-in account.
    runStart: {
      // How long the identify request may be retried in all; it fits inside the dashboard's 60 s request timeout.
      identifyRetryBudgetMs: 45000,
      // After a refused run start, Build and Continue send nothing to RSI for this long.
      coolDownMs: 60000
    },
    // The brakes: how a run slows down when RSI refuses or answers slowly, and speeds up again.
    brakes: {
      // Every run starts this much slower than the fastest baseline: 100 is twice the interval.
      startSlowerPercent: 100,
      // Each period of good answers makes the run this much faster.
      speedUpPercent: 20,
      // The length of one such period.
      speedUpEveryMs: 20000,
      // From a refusal to the first try of the refused pace again.
      retestFirstMs: 300000,
      // The longest wait before the refused pace is tried again; the wait doubles after each failed try.
      retestMaximumMs: 1200000,
      // Each refusal makes the interval this much longer: 100 doubles it.
      slowDownPercent: 100,
      // The longest step interval or image start gap.
      maximumIntervalMs: 120000,
      // No wait inside a step is longer than this; a longer gap is kept as a request slot.
      maximumInStepWaitMs: 10000,
      // The first wait before a refused step is tried again; it doubles with each refused attempt.
      firstWaitMs: 5000,
      // The longest wait before a refused step is tried again.
      maximumWaitMs: 300000,
      // After a refusal, speed-ups stop this much slower than the refused pace until it is tried again.
      wallMarginPercent: 25,
      // The random addition to any interval other than a section's baseline, as a share of it.
      slowedJitterPercent: 15,
      // Answers are slow when their recent median is over this many times their normal time ...
      latencyRatio: 2,
      // ... and over this long.
      latencyMinimumMs: 1000,
      // Slow answers alone slow the run down by at most this much.
      latencyBrakeMaximumPercent: 100,
      // A single timeout, 500 or network failure is tried once more without braking, when no refusal came this long
      // before it.
      freeRetryQuietMs: 600000,
      // This long without one accepted answer, the run stops for the time being.
      giveUpAfterRefusingMs: 1800000,
      // After that stop, Build and Continue send nothing to RSI for this long.
      coolDownMs: 300000,
      // A run stops this long before its authorization ends.
      lifetimeMarginMs: 60000
    },
    // Setting a changed section aside, to read the rest of the account.
    setAside: {
      // No section is set aside this soon after a refusal.
      quietMs: 600000,
      // At most this many sections are set aside in one run; 0 sets none aside.
      maximumSections: 3
    },
    // The smart check: RSI's own status page, read while a warning shows.
    smartCheck: {
      // The one address the status check reads: the status page's own JSON feed.
      statusFeedUrl: "https://status.robertsspaceindustries.com/index.json",
      // At most one status request this often; RSI caches the feed for as long.
      statusPageCacheMs: 300000,
      // The status request gives up after this long, so it never holds up a run.
      statusTimeoutMs: 5000
    },
    // The retained pace history.
    history: {
      // Detailed run summaries kept before their counts are merged into the totals.
      detailedRuns: 100,
      // Distinct answer kinds a run summary counts before the rest are counted together.
      maximumSignalBuckets: 64,
      // Accepted response times kept for each kind of request.
      maximumLatencySamplesPerRequestFamily: 25
    },
    // The most requests a run may send beyond its planned ones, by kind. Each kind has its own count.
    requestBounds: {
      // Tries again of refused steps in an account build.
      accountRetries: 256,
      // Tries again of refused steps in a roster run.
      rosterRetries: 64,
      // Identify requests and session checks before a step whose last attempt was unclear.
      canaryAndSessionChecks: 128,
      // Requests without the session cookie at the give-up: the account's public dossier, read to see whether RSI
      // refuses even without the login.
      probes: 1,
      // Reads of RSI's status page.
      statusChecks: 72
    }
  };

  // The 15 account sections, in the canonical order of `accountBuild.sectionOrder`.
  const SECTION_IDS = Object.freeze([
    "profile", "hangarLog",
    "financial.balances", "financial.billingTotal", "financial.ledgers", "financial.orders", "financial.subscriptions",
    "pledges", "buybacks",
    "referrals.legacy.recruits", "referrals.current.prospects", "referrals.current.recruits",
    "organizations.memberships", "buybackDetails", "buybackUpgradePrices"
  ]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function integer(minimum, maximum) {
    return { kind: "integer", minimum, maximum };
  }

  // A number that need not be whole.
  function number(minimum, maximum) {
    return { kind: "number", minimum, maximum };
  }

  // A string that starts with the given text.
  function prefixed(prefix) {
    return { kind: "prefixed", prefix };
  }

  // The keys each object holds, and the bounds of each integer value.
  const BASELINE_ENTRY = { intervalMs: integer(250, 120000), jitterMs: integer(0, 2000), jitterPercent: integer(0, 50), lanes: integer(1, 2) };
  const SHAPE = {
    accountBuild: { requestTimeoutMs: integer(5000, 30000), staggerPercent: integer(1, 100) },
    images: {
      startGapMinimumMs: integer(50, 120000),
      startGapMaximumMs: integer(50, 120000),
      concurrency: integer(2, 4),
      attempts: integer(1, 3),
      retryMinimumMs: integer(100, 60000),
      retryMaximumMs: integer(100, 60000),
      controlImageReuseMs: integer(1000, 60000),
      maximumRefusedAttemptsPerImage: integer(1, 20)
    },
    runStart: { identifyRetryBudgetMs: integer(0, 55000), coolDownMs: integer(0, 3600000) },
    brakes: {
      startSlowerPercent: integer(0, 1000),
      speedUpPercent: integer(1, 100),
      speedUpEveryMs: integer(1000, 600000),
      retestFirstMs: integer(10000, 86400000),
      retestMaximumMs: integer(10000, 86400000),
      slowDownPercent: integer(1, 1000),
      maximumIntervalMs: integer(1000, 3600000),
      maximumInStepWaitMs: integer(250, 25000),
      firstWaitMs: integer(1000, 3600000),
      maximumWaitMs: integer(1000, 3600000),
      wallMarginPercent: integer(0, 100),
      slowedJitterPercent: integer(0, 50),
      latencyRatio: number(1.1, 10),
      latencyMinimumMs: integer(100, 30000),
      latencyBrakeMaximumPercent: integer(0, 1000),
      freeRetryQuietMs: integer(0, 3600000),
      giveUpAfterRefusingMs: integer(60000, 21600000),
      coolDownMs: integer(0, 3600000),
      lifetimeMarginMs: integer(0, 600000)
    },
    setAside: { quietMs: integer(0, 3600000), maximumSections: integer(0, 10) },
    smartCheck: { statusFeedUrl: prefixed("https://status.robertsspaceindustries.com/"), statusPageCacheMs: integer(60000, 3600000), statusTimeoutMs: integer(1000, 10000) },
    history: { detailedRuns: integer(1, 100), maximumSignalBuckets: integer(8, 256), maximumLatencySamplesPerRequestFamily: integer(5, 100) },
    requestBounds: { accountRetries: integer(0, 10000), rosterRetries: integer(0, 10000), canaryAndSessionChecks: integer(0, 10000), probes: integer(0, 10000), statusChecks: integer(0, 10000) }
  };

  // The message of the first key that is missing, extra or out of range, or null.
  function exactKeys(value, expected, name) {
    if (!isObject(value)) return `${name} must be an object.`;
    for (const key of expected) if (!Object.hasOwn(value, key)) return `${name}.${key} is missing.`;
    for (const key of Object.keys(value)) if (!expected.includes(key)) return `${name}.${key} is not a known setting.`;
    return null;
  }

  function checkInteger(value, bounds, name) {
    if (!Number.isSafeInteger(value)) return `${name} must be a whole number.`;
    if (value < bounds.minimum || value > bounds.maximum) return `${name} must be from ${bounds.minimum} to ${bounds.maximum}.`;
    return null;
  }

  // One value of a group, by the kind of its rule.
  function checkValue(value, rule, name) {
    if (rule.kind === "prefixed") return typeof value === "string" && value.startsWith(rule.prefix) ? null : `${name} must be an address that starts with ${rule.prefix}.`;
    if (rule.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${name} must be a number.`;
      return value < rule.minimum || value > rule.maximum ? `${name} must be from ${rule.minimum} to ${rule.maximum}.` : null;
    }
    return checkInteger(value, rule, name);
  }

  function checkGroup(value, shape, name) {
    const keys = exactKeys(value, Object.keys(shape), name);
    if (keys) return keys;
    for (const [key, rule] of Object.entries(shape)) {
      const message = checkValue(value[key], rule, `${name}.${key}`);
      if (message) return message;
    }
    return null;
  }

  // No baseline interval is longer than the longest interval the brakes allow.
  function checkIntervalsWithinBrakes(candidate) {
    const longest = candidate.brakes.maximumIntervalMs;
    const entries = [...SECTION_IDS.map((id) => [`accountBuild.sections["${id}"].intervalMs`, candidate.accountBuild.sections[id].intervalMs]), ["organizationRosters.intervalMs", candidate.organizationRosters.intervalMs]];
    const over = entries.find(([, intervalMs]) => intervalMs > longest);
    return over ? `${over[0]} must be at most brakes.maximumIntervalMs.` : null;
  }

  // A baseline entry: an interval, exactly one of jitterMs and jitterPercent, and its lanes.
  function checkBaselineEntry(entry, name) {
    if (!isObject(entry)) return `${name} must be an object.`;
    const jitterKeys = ["jitterMs", "jitterPercent"].filter((key) => Object.hasOwn(entry, key));
    if (jitterKeys.length !== 1) return `${name} must hold exactly one of jitterMs and jitterPercent.`;
    const keys = exactKeys(entry, ["intervalMs", jitterKeys[0], "lanes"], name);
    if (keys) return keys;
    for (const key of ["intervalMs", jitterKeys[0], "lanes"]) {
      const message = checkInteger(entry[key], BASELINE_ENTRY[key], `${name}.${key}`);
      if (message) return message;
    }
    return null;
  }

  function checkSectionOrder(order) {
    const name = "accountBuild.sectionOrder";
    if (!Array.isArray(order)) return `${name} must be a list.`;
    if (order.length !== SECTION_IDS.length || order.some((id, index) => id !== SECTION_IDS[index])) {
      return `${name} must name the ${SECTION_IDS.length} account sections once each, in the order ${SECTION_IDS.join(", ")}.`;
    }
    return null;
  }

  function checkAccountBuild(accountBuild) {
    const name = "accountBuild";
    const keys = exactKeys(accountBuild, ["requestTimeoutMs", "staggerPercent", "sectionOrder", "sections"], name);
    if (keys) return keys;
    for (const [key, bounds] of Object.entries(SHAPE.accountBuild)) {
      const message = checkInteger(accountBuild[key], bounds, `${name}.${key}`);
      if (message) return message;
    }
    const order = checkSectionOrder(accountBuild.sectionOrder);
    if (order) return order;
    const sections = exactKeys(accountBuild.sections, SECTION_IDS, `${name}.sections`);
    if (sections) return sections;
    for (const id of SECTION_IDS) {
      const message = checkBaselineEntry(accountBuild.sections[id], `${name}.sections["${id}"]`);
      if (message) return message;
    }
    return null;
  }

  // Null when the settings are valid, or the message of the first rule that fails, naming the key.
  function validateRequestPacingSettings(candidate) {
    const top = exactKeys(candidate, ["version", "accountBuild", "organizationRosters", "images", "runStart", "brakes", "setAside", "smartCheck", "history", "requestBounds"], "settings");
    if (top) return top;
    if (candidate.version !== 1) return "version must be 1.";
    const checks = [
      () => checkAccountBuild(candidate.accountBuild),
      () => checkBaselineEntry(candidate.organizationRosters, "organizationRosters"),
      () => checkGroup(candidate.images, SHAPE.images, "images"),
      () => candidate.images.startGapMinimumMs > candidate.images.startGapMaximumMs ? "images.startGapMinimumMs must be at most images.startGapMaximumMs." : null,
      () => candidate.images.retryMinimumMs > candidate.images.retryMaximumMs ? "images.retryMinimumMs must be at most images.retryMaximumMs." : null,
      () => checkGroup(candidate.runStart, SHAPE.runStart, "runStart"),
      () => checkGroup(candidate.brakes, SHAPE.brakes, "brakes"),
      () => candidate.brakes.retestFirstMs > candidate.brakes.retestMaximumMs ? "brakes.retestFirstMs must be at most brakes.retestMaximumMs." : null,
      () => candidate.brakes.firstWaitMs > candidate.brakes.maximumWaitMs ? "brakes.firstWaitMs must be at most brakes.maximumWaitMs." : null,
      () => checkIntervalsWithinBrakes(candidate),
      () => checkGroup(candidate.setAside, SHAPE.setAside, "setAside"),
      () => checkGroup(candidate.smartCheck, SHAPE.smartCheck, "smartCheck"),
      () => checkGroup(candidate.history, SHAPE.history, "history"),
      () => checkGroup(candidate.requestBounds, SHAPE.requestBounds, "requestBounds")
    ];
    for (const check of checks) {
      const message = check();
      if (message) return message;
    }
    return null;
  }

  // The settings as one canonical JSON text: object keys sorted, arrays in order, no spaces.
  function canonicalSettingsJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalSettingsJson).join(",")}]`;
    if (isObject(value)) {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalSettingsJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  // The lower-case hexadecimal SHA-256 of the canonical JSON text, encoded as UTF-8.
  async function settingsFingerprint(value = settings) {
    const bytes = new TextEncoder().encode(canonicalSettingsJson(value));
    const digest = await root.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function deepFreeze(value) {
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) deepFreeze(child);
      Object.freeze(value);
    }
    return value;
  }

  deepFreeze(settings);

  return Object.freeze({
    settings,
    SECTION_IDS,
    validationMessage: validateRequestPacingSettings(settings),
    validateRequestPacingSettings,
    canonicalSettingsJson,
    settingsFingerprint
  });
});

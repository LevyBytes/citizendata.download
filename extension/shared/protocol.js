(function initializeCitizenDataProtocol(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataProtocol = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataProtocol() {
  "use strict";

  // 2: terminal `partial`, the bounded failure and the ordered status fields (PARSER_HARDENING.md §12.6). The dashboard's
  // PROTOCOL_VERSION must be the same number.
  const VERSION = 2;
  const CHANNEL = "citizendata.dashboard.v1";
  // The hosted dashboard. It connects without asking.
  const DASHBOARD_ORIGIN = "https://citizendata.download";
  const DASHBOARD_ORIGINS = Object.freeze([DASHBOARD_ORIGIN]);
  // A downloaded copy is recognised by its place in the repository layout, in any folder: <folder>/docs/index.html.
  // It connects only after the user approves that exact path in the extension popup.
  const LOCAL_DASHBOARD_MATCH = "file:///*/docs/index.html";
  const LOCAL_DASHBOARD_PATH = /^\/(?:[^/]+\/)*docs\/index\.html$/u;
  const MAXIMUM_LOCAL_PATH_LENGTH = 2048;
  const REQUEST_TYPES = Object.freeze({
    GET_STATUS: "GET_STATUS",
    GET_PARTIAL_RESULT: "GET_PARTIAL_RESULT",
    GET_COMPLETED_RESULT: "GET_COMPLETED_RESULT",
    GET_LATEST_BUILD: "GET_LATEST_BUILD",
    // Accounts (`capabilities.accounts`): the added accounts and the retained builds Build History allows, one
    // retained build by its account key, the account of the RSI session found by RSI's identify route alone, the
    // account the dashboard has chosen, and one account the user removes. None of them starts a build or names an
    // address.
    LIST_ACCOUNTS: "LIST_ACCOUNTS",
    GET_ACCOUNT_BUILD: "GET_ACCOUNT_BUILD",
    DISCOVER_CURRENT_ACCOUNT: "DISCOVER_CURRENT_ACCOUNT",
    SELECT_ACCOUNT: "SELECT_ACCOUNT",
    REMOVE_ACCOUNT: "REMOVE_ACCOUNT",
    KEEP_BUILD: "KEEP_BUILD",
    KEEP_ORGANIZATIONS: "KEEP_ORGANIZATIONS",
    ACKNOWLEDGE_RESULT: "ACKNOWLEDGE_RESULT",
    CONTINUE_PARTIAL: "CONTINUE_PARTIAL",
    PROPOSE_BUILD: "PROPOSE_BUILD",
    PROPOSE_ORGANIZATION_ROSTER: "PROPOSE_ORGANIZATION_ROSTER",
    // Images the dashboard downloaded: which are kept, their bytes, and new ones to keep.
    GET_KEPT_IMAGES: "GET_KEPT_IMAGES",
    GET_KEPT_IMAGE_FILES: "GET_KEPT_IMAGE_FILES",
    KEEP_IMAGES: "KEEP_IMAGES",
    REQUEST_REBIND: "REQUEST_REBIND",
    PAUSE: "PAUSE",
    RESUME: "RESUME",
    CANCEL: "CANCEL",
    // Ends the reading of CCU buy-back prices where it stands; the build goes on to finish.
    SKIP_CCU_PRICES: "SKIP_CCU_PRICES",
    // RSI's status feed, for the image run (PARSER_HARDENING.md §12.7).
    CHECK_RSI_STATUS: "CHECK_RSI_STATUS",
    // The image hosts' own pace history (§14): read it, and add one finished image run to it.
    GET_IMAGE_PACE_HISTORY: "GET_IMAGE_PACE_HISTORY",
    ADD_IMAGE_PACE_RUN: "ADD_IMAGE_PACE_RUN"
  });
  const UI_REQUEST_TYPES = Object.freeze({
    GET_STATUS: "GET_STATUS",
    EXPORT_BACKUP: "EXPORT_BACKUP",
    IMPORT_BACKUP: "IMPORT_BACKUP",
    LIST_INCOMPLETE_RUNS: "LIST_INCOMPLETE_RUNS",
    DELETE_INCOMPLETE_RUN: "DELETE_INCOMPLETE_RUN",
    CLEAR_ALL: "CLEAR_ALL",
    GET_LOCAL_DASHBOARDS: "GET_LOCAL_DASHBOARDS",
    APPROVE_LOCAL_DASHBOARD: "APPROVE_LOCAL_DASHBOARD",
    REVOKE_LOCAL_DASHBOARD: "REVOKE_LOCAL_DASHBOARD",
    GET_BUILD_HISTORY: "GET_BUILD_HISTORY",
    SET_BUILD_HISTORY: "SET_BUILD_HISTORY",
    GET_BUILD_HISTORY_COPY: "GET_BUILD_HISTORY_COPY",
    DELETE_BUILD_HISTORY_COPY: "DELETE_BUILD_HISTORY_COPY",
    CLEAR_BUILD_HISTORY: "CLEAR_BUILD_HISTORY",
    CLEAR_KEPT_IMAGES: "CLEAR_KEPT_IMAGES"
  });
  const EVENT_TYPES = Object.freeze({
    BRIDGE_READY: "BRIDGE_READY",
    LOCAL_APPROVAL_REQUIRED: "LOCAL_APPROVAL_REQUIRED",
    RESPONSE: "RESPONSE",
    STATUS: "STATUS",
    RESULT: "RESULT"
  });
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  // An account is named by its key alone: `rsi:` and its handle in lower case (storage/account-registry.js).
  const ACCOUNT_KEY_PATTERN = /^rsi:[a-z0-9_-]{1,64}$/u;
  const ACCOUNT_PAYLOADS = Object.freeze({
    LIST_ACCOUNTS: "none",
    DISCOVER_CURRENT_ACCOUNT: "none",
    GET_ACCOUNT_BUILD: "accountKey",
    SELECT_ACCOUNT: "accountKey",
    REMOVE_ACCOUNT: "accountKey"
  });

  function isAccountKey(value) {
    return typeof value === "string" && ACCOUNT_KEY_PATTERN.test(value);
  }

  // The payload of an account request is nothing at all, or exactly { accountKey }.
  function validAccountPayload(type, payload) {
    if (ACCOUNT_PAYLOADS[type] === "none") return payload === null || payload === undefined;
    return isPlainObject(payload) && Object.keys(payload).length === 1 && isAccountKey(payload.accountKey);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
  }

  function isLocalDashboardPath(pathname) {
    return typeof pathname === "string" && pathname.length <= MAXIMUM_LOCAL_PATH_LENGTH && LOCAL_DASHBOARD_PATH.test(pathname);
  }

  function isLocalDashboardOrigin(origin) {
    return origin === "null" || origin === "file://";
  }

  // Says only that a page is in a place a dashboard may live. A local copy must also be approved before the extension serves it.
  function isDashboardLocation(origin, pathname = "/") {
    if (isLocalDashboardOrigin(origin)) return isLocalDashboardPath(pathname);
    return DASHBOARD_ORIGINS.includes(origin) && typeof pathname === "string" && pathname.startsWith("/");
  }

  function canonicalDashboardOrigin(origin) {
    return isLocalDashboardOrigin(origin) ? "file://" : origin;
  }

  function postMessageTarget(origin) {
    return canonicalDashboardOrigin(origin) === "file://" ? "*" : origin;
  }

  function messageOriginMatches(eventOrigin, pageOrigin) {
    return canonicalDashboardOrigin(pageOrigin) === "file://"
      ? eventOrigin === "null"
      : eventOrigin === pageOrigin;
  }

  function normalizedKey(key) {
    return key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  }

  function isSecretKey(key) {
    const normalized = normalizedKey(key);
    return ["credential", "credentials", "html", "mfa", "password", "rawbody", "rawhtml"].includes(normalized)
      || normalized.includes("cookie")
      || normalized === "header"
      || normalized.endsWith("header")
      || normalized.endsWith("headers")
      || normalized.endsWith("token");
  }

  function isRequestAuthorityKey(key) {
    const normalized = normalizedKey(key);
    return isSecretKey(key)
      || normalized === "body"
      || normalized === "method"
      || normalized === "headers"
      || normalized === "header"
      || normalized.endsWith("url");
  }

  function containsMatchingField(value, predicate, depth = 0) {
    if (depth > 12) return true;
    if (Array.isArray(value)) return value.some((item) => containsMatchingField(item, predicate, depth + 1));
    if (!isPlainObject(value)) return false;
    return Object.entries(value).some(([key, child]) => predicate(key) || containsMatchingField(child, predicate, depth + 1));
  }

  function containsSecretField(value) {
    return containsMatchingField(value, isSecretKey);
  }

  function containsForbiddenRequestField(value) {
    return containsMatchingField(value, isRequestAuthorityKey);
  }

  function makeEnvelope({ type, requestId, bridgeSessionId, nonce, payload = null }) {
    return { channel: CHANNEL, protocolVersion: VERSION, type, requestId, bridgeSessionId, nonce, payload };
  }

  function validatePageEnvelope(value, expected) {
    if (!isPlainObject(value)) return { ok: false, code: "INVALID_ENVELOPE" };
    const keys = Object.keys(value).sort();
    const allowedKeys = ["bridgeSessionId", "channel", "nonce", "payload", "protocolVersion", "requestId", "type"].sort();
    if (keys.length !== allowedKeys.length || keys.some((key, index) => key !== allowedKeys[index])) return { ok: false, code: "UNEXPECTED_ENVELOPE_FIELD" };
    if (value.channel !== CHANNEL || value.protocolVersion !== VERSION) return { ok: false, code: "PROTOCOL_MISMATCH" };
    if (!Object.values(REQUEST_TYPES).includes(value.type)) return { ok: false, code: "UNKNOWN_REQUEST" };
    if (!UUID_PATTERN.test(value.requestId) || !UUID_PATTERN.test(value.bridgeSessionId)) return { ok: false, code: "INVALID_REQUEST_ID" };
    if (typeof value.nonce !== "string" || value.nonce.length < 32 || value.nonce.length > 128) return { ok: false, code: "INVALID_NONCE" };
    if (expected?.bridgeSessionId && value.bridgeSessionId !== expected.bridgeSessionId) return { ok: false, code: "BRIDGE_SESSION_MISMATCH" };
    if (expected?.nonce && value.nonce !== expected.nonce) return { ok: false, code: "NONCE_MISMATCH" };
    // An account file or an Orgs JSON handed over to be kept records the addresses its data was read from, so the
    // scan for request fields does not fit it. Its payload is the document and nothing else, and it still carries
    // no secret field.
    if (value.type === REQUEST_TYPES.KEEP_BUILD || value.type === REQUEST_TYPES.KEEP_ORGANIZATIONS) {
      const payload = value.payload;
      if (!isPlainObject(payload) || Object.keys(payload).length !== 1 || !isPlainObject(payload.document) || containsSecretField(payload)) return { ok: false, code: "FORBIDDEN_PAYLOAD_FIELD" };
    } else if (Object.hasOwn(ACCOUNT_PAYLOADS, value.type)) {
      if (!validAccountPayload(value.type, value.payload)) return { ok: false, code: "INVALID_ACCOUNT_PAYLOAD" };
    } else if (containsForbiddenRequestField(value.payload)) return { ok: false, code: "FORBIDDEN_PAYLOAD_FIELD" };
    return { ok: true, value };
  }

  // `settings` is the extension's copy of the pacing settings; its plan floors tell a dashboard of another version the
  // slowest floor this extension accepts (§4.6).
  function publicCapabilities(registry = {}, settings = null) {
    const collectionEnabled = Array.isArray(registry.adapters) && registry.adapters.length > 0;
    const sections = Object.values(settings?.accountBuild?.sections ?? {}).map((section) => section?.intervalMs).filter(Number.isSafeInteger);
    const rosterFloorMs = settings?.organizationRosters?.intervalMs;
    return Object.freeze({
      pacing: sections.length > 0 && Number.isSafeInteger(rosterFloorMs)
        ? Object.freeze({ accountPlanFloorMs: Math.min(...sections), rosterPlanFloorMs: rosterFloorMs })
        : null,
      buildJson: collectionEnabled,
      loadJson: true,
      accountCollection: collectionEnabled,
      organizationRosterCollection: collectionEnabled && registry.organizationRosterCollection === true,
      offlineMediaPackage: registry.offlineMediaPackage === true,
      // LIST_ACCOUNTS, GET_ACCOUNT_BUILD, DISCOVER_CURRENT_ACCOUNT, SELECT_ACCOUNT and REMOVE_ACCOUNT are answered, and a build or
      // roster proposal may name the account it expects to find signed in (`expectedAccountKey`).
      accounts: true,
      reason: collectionEnabled
        ? "Account collection is ready from the Star Citizen Data Downloader dashboard."
        : (registry.reason ?? "No account collection adapters are available in this build.")
    });
  }

  return Object.freeze({
    VERSION,
    CHANNEL,
    DASHBOARD_ORIGIN,
    DASHBOARD_ORIGINS,
    LOCAL_DASHBOARD_MATCH,
    REQUEST_TYPES,
    UI_REQUEST_TYPES,
    EVENT_TYPES,
    isPlainObject,
    isAccountKey,
    isLocalDashboardPath,
    isLocalDashboardOrigin,
    isDashboardLocation,
    canonicalDashboardOrigin,
    postMessageTarget,
    messageOriginMatches,
    containsSecretField,
    containsForbiddenRequestField,
    makeEnvelope,
    validatePageEnvelope,
    publicCapabilities
  });
});

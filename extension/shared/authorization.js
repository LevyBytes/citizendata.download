(function initializeCitizenDataAuthorization(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataAuthorization = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataAuthorization() {
  "use strict";

  const POLICY_VERSION = 1;
  const DEFAULT_TTL_MS = 15 * 60 * 1000;
  const MAXIMUM_TTL_MS = 30 * 60 * 1000;
  const DEFAULT_RUN_TTL_MS = 6 * 60 * 60 * 1000;
  const MAXIMUM_RUN_TTL_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
  const MAXIMUM_IDLE_TTL_MS = 2 * 60 * 60 * 1000;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && Object.prototype.toString.call(value) === "[object Object]";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function iso(value) {
    return new Date(value).toISOString();
  }

  function createProposal(input) {
    if (!isPlainObject(input) || !isPlainObject(input.plan)) throw new TypeError("A validated plan is required.");
    if (typeof input.proposalId !== "string" || input.proposalId.length < 16) throw new TypeError("A proposal ID is required.");
    if (typeof input.dashboardOrigin !== "string" || typeof input.bridgeSessionId !== "string") throw new TypeError("Dashboard binding is required.");
    const createdMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
    const requestedTtl = Number.isFinite(input.ttlMs) ? input.ttlMs : DEFAULT_TTL_MS;
    const ttlMs = Math.max(1, Math.min(requestedTtl, MAXIMUM_TTL_MS));
    return Object.freeze({
      policyVersion: POLICY_VERSION,
      proposalId: input.proposalId,
      status: "awaiting-authorization",
      dashboardOrigin: input.dashboardOrigin,
      dashboardPath: input.dashboardPath,
      dashboardTabId: Number.isSafeInteger(input.dashboardTabId) ? input.dashboardTabId : null,
      bridgeSessionId: input.bridgeSessionId,
      plan: clone(input.plan),
      parserVersions: Object.freeze({ ...(input.parserVersions ?? {}) }),
      createdAt: iso(createdMs),
      expiresAt: iso(createdMs + ttlMs)
    });
  }

  function proposalIsCurrent(proposal, nowMs = Date.now()) {
    return isPlainObject(proposal)
      && proposal.policyVersion === POLICY_VERSION
      && proposal.status === "awaiting-authorization"
      && Number.isFinite(Date.parse(proposal.expiresAt))
      && Date.parse(proposal.expiresAt) > nowMs;
  }

  function createAuthorization(proposal, input) {
    if (!proposalIsCurrent(proposal, input?.nowMs)) return { ok: false, code: "PROPOSAL_EXPIRED" };
    if (input?.permissionGranted !== true) return { ok: false, code: "HOST_PERMISSION_REQUIRED" };
    if (typeof input.accountId !== "string" || input.accountId.trim().length === 0) return { ok: false, code: "ACCOUNT_BINDING_REQUIRED" };
    if (!UUID_PATTERN.test(input.authorizationId)) return { ok: false, code: "INVALID_AUTHORIZATION_ID" };
    if (!UUID_PATTERN.test(input.runId)) return { ok: false, code: "INVALID_RUN_ID" };
    if (!UUID_PATTERN.test(input.localAccountId)) return { ok: false, code: "INVALID_LOCAL_ACCOUNT_ID" };
    if (!SHA256_PATTERN.test(input.planHash)) return { ok: false, code: "INVALID_PLAN_HASH" };
    if (typeof input.extensionVersion !== "string" || input.extensionVersion.trim().length === 0) return { ok: false, code: "INVALID_EXTENSION_VERSION" };
    const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
    const requestedRunTtl = Number.isFinite(input.runTtlMs) ? input.runTtlMs : DEFAULT_RUN_TTL_MS;
    const runTtlMs = Math.max(1, Math.min(requestedRunTtl, MAXIMUM_RUN_TTL_MS));
    const requestedIdleTtl = Number.isFinite(input.idleTtlMs) ? input.idleTtlMs : DEFAULT_IDLE_TTL_MS;
    const idleTtlMs = Math.max(1, Math.min(requestedIdleTtl, MAXIMUM_IDLE_TTL_MS, runTtlMs));
    const expiresAtMs = nowMs + runTtlMs;
    const authorization = Object.freeze({
      policyVersion: POLICY_VERSION,
      authorizationId: input.authorizationId,
      runId: input.runId,
      proposalId: proposal.proposalId,
      accountId: input.accountId.trim(),
      localAccountId: input.localAccountId,
      dashboardOrigin: proposal.dashboardOrigin,
      dashboardPath: proposal.dashboardPath,
      dashboardTabId: proposal.dashboardTabId,
      bridgeSessionId: proposal.bridgeSessionId,
      selectedSections: Object.freeze([...proposal.plan.selectedSections]),
      maximumRecordsBySection: Object.freeze({ ...proposal.plan.maximumRecordsBySection }),
      minimumInterRequestDelayMs: proposal.plan.minimumInterRequestDelayMs,
      parserVersions: Object.freeze({ ...proposal.parserVersions }),
      planHash: input.planHash,
      extensionVersion: input.extensionVersion.trim(),
      oneRunOnly: true,
      issuedAt: iso(nowMs),
      expiresAt: iso(expiresAtMs),
      idleTtlMs,
      lastActivityAt: iso(nowMs),
      idleExpiresAt: iso(Math.min(expiresAtMs, nowMs + idleTtlMs)),
      consumedAt: null,
      revokedAt: null
    });
    return { ok: true, value: authorization };
  }

  function validateAuthorization(authorization, expected, nowMs = Date.now()) {
    if (!isPlainObject(authorization) || authorization.policyVersion !== POLICY_VERSION) return { ok: false, code: "INVALID_AUTHORIZATION" };
    if (authorization.revokedAt) return { ok: false, code: "AUTHORIZATION_REVOKED" };
    if (authorization.consumedAt) return { ok: false, code: "AUTHORIZATION_CONSUMED" };
    if (Date.parse(authorization.expiresAt) <= nowMs) return { ok: false, code: "AUTHORIZATION_EXPIRED" };
    if (!Number.isSafeInteger(authorization.idleTtlMs) || authorization.idleTtlMs < 1 || Date.parse(authorization.idleExpiresAt) <= nowMs) return { ok: false, code: "AUTHORIZATION_IDLE_EXPIRED" };
    for (const key of ["runId", "accountId", "dashboardOrigin", "bridgeSessionId"]) {
      if (expected?.[key] !== undefined && authorization[key] !== expected[key]) return { ok: false, code: "AUTHORIZATION_BINDING_MISMATCH" };
    }
    if (expected?.section && !authorization.selectedSections.includes(expected.section)) return { ok: false, code: "SECTION_NOT_AUTHORIZED" };
    return { ok: true, value: authorization };
  }

  function touchAuthorization(authorization, nowMs = Date.now()) {
    const checked = validateAuthorization(authorization, {}, nowMs);
    if (!checked.ok) return checked;
    const hardExpiry = Date.parse(authorization.expiresAt);
    return {
      ok: true,
      value: Object.freeze({
        ...authorization,
        lastActivityAt: iso(nowMs),
        idleExpiresAt: iso(Math.min(hardExpiry, nowMs + authorization.idleTtlMs))
      })
    };
  }

  function createRebindRequest(authorization, input) {
    if (!isPlainObject(authorization) || authorization.policyVersion !== POLICY_VERSION) throw new TypeError("A current authorization is required.");
    if (authorization.revokedAt || authorization.consumedAt) throw new TypeError("A terminal authorization cannot be rebound.");
    if (typeof input?.rebindId !== "string" || input.rebindId.length < 16) throw new TypeError("A rebind ID is required.");
    if (typeof input.dashboardOrigin !== "string" || input.dashboardOrigin !== authorization.dashboardOrigin) throw new TypeError("The dashboard origin does not match the authorized run.");
    if (typeof input.dashboardPath !== "string" || typeof input.bridgeSessionId !== "string") throw new TypeError("The new dashboard binding is required.");
    const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
    const ttlMs = Math.max(1, Math.min(Number.isFinite(input.ttlMs) ? input.ttlMs : DEFAULT_TTL_MS, MAXIMUM_TTL_MS));
    if (Date.parse(authorization.expiresAt) <= nowMs || Date.parse(authorization.idleExpiresAt) <= nowMs) throw new TypeError("The authorized run has expired.");
    return Object.freeze({
      policyVersion: POLICY_VERSION,
      proposalId: input.rebindId,
      kind: "dashboard-rebind",
      status: "awaiting-authorization",
      authorizationId: authorization.authorizationId,
      jobId: input.jobId,
      accountId: authorization.accountId,
      dashboardOrigin: input.dashboardOrigin,
      dashboardPath: input.dashboardPath,
      dashboardTabId: Number.isSafeInteger(input.dashboardTabId) ? input.dashboardTabId : null,
      bridgeSessionId: input.bridgeSessionId,
      selectedSections: Object.freeze([...authorization.selectedSections]),
      createdAt: iso(nowMs),
      expiresAt: iso(Math.min(Date.parse(authorization.expiresAt), nowMs + ttlMs))
    });
  }

  function rebindRequestIsCurrent(request, nowMs = Date.now()) {
    return isPlainObject(request)
      && request.policyVersion === POLICY_VERSION
      && request.kind === "dashboard-rebind"
      && request.status === "awaiting-authorization"
      && Number.isFinite(Date.parse(request.expiresAt))
      && Date.parse(request.expiresAt) > nowMs;
  }

  function rebindAuthorization(authorization, request, nowMs = Date.now()) {
    if (!rebindRequestIsCurrent(request, nowMs)) return { ok: false, code: "REBIND_EXPIRED" };
    if (!isPlainObject(authorization) || authorization.authorizationId !== request.authorizationId || authorization.accountId !== request.accountId) return { ok: false, code: "REBIND_AUTHORIZATION_MISMATCH" };
    if (authorization.revokedAt || authorization.consumedAt || Date.parse(authorization.expiresAt) <= nowMs || Date.parse(authorization.idleExpiresAt) <= nowMs) return { ok: false, code: "AUTHORIZATION_EXPIRED" };
    return {
      ok: true,
      value: Object.freeze({
        ...authorization,
        dashboardOrigin: request.dashboardOrigin,
        dashboardPath: request.dashboardPath,
        dashboardTabId: request.dashboardTabId,
        bridgeSessionId: request.bridgeSessionId,
        lastActivityAt: iso(nowMs),
        idleExpiresAt: iso(Math.min(Date.parse(authorization.expiresAt), nowMs + authorization.idleTtlMs)),
        reboundAt: iso(nowMs)
      })
    };
  }

  function runAuthorizationReceipt(authorization) {
    if (!isPlainObject(authorization)) throw new TypeError("A run authorization is required.");
    return {
      authorizationId: authorization.authorizationId,
      authorizedAt: authorization.issuedAt,
      expiresAt: authorization.expiresAt,
      localAccountId: authorization.localAccountId,
      dashboardOrigin: authorization.dashboardOrigin,
      bridgeSessionId: authorization.bridgeSessionId,
      planHash: authorization.planHash,
      selectedSections: [...authorization.selectedSections],
      maximumRecordsBySection: { ...authorization.maximumRecordsBySection },
      minimumInterRequestDelayMs: authorization.minimumInterRequestDelayMs,
      extensionVersion: authorization.extensionVersion,
      parserVersions: { ...authorization.parserVersions },
      oneRunOnly: true
    };
  }

  function publicProposal(proposal) {
    if (!isPlainObject(proposal)) return null;
    return {
      proposalId: proposal.proposalId,
      status: proposal.status,
      selectedSections: [...proposal.plan.selectedSections],
      maximumRecordsBySection: { ...proposal.plan.maximumRecordsBySection },
      minimumInterRequestDelayMs: proposal.plan.minimumInterRequestDelayMs,
      parserVersions: { ...proposal.parserVersions },
      createdAt: proposal.createdAt,
      expiresAt: proposal.expiresAt
    };
  }

  return Object.freeze({
    POLICY_VERSION,
    DEFAULT_TTL_MS,
    MAXIMUM_TTL_MS,
    DEFAULT_RUN_TTL_MS,
    MAXIMUM_RUN_TTL_MS,
    DEFAULT_IDLE_TTL_MS,
    MAXIMUM_IDLE_TTL_MS,
    createProposal,
    proposalIsCurrent,
    createAuthorization,
    validateAuthorization,
    touchAuthorization,
    createRebindRequest,
    rebindRequestIsCurrent,
    rebindAuthorization,
    runAuthorizationReceipt,
    publicProposal
  });
});

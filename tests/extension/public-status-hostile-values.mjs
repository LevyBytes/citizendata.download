import assert from "node:assert/strict";

// Hostile values for the public-status bounds (PARSER_HARDENING.md §12.5): a 2,000-character field, more than 75
// activities with extra and nested fields, unknown kinds, and counts that are negative, fractional or unsafe.
export const LONG = "X".repeat(2000);

// RSI's message as a hostile answer could write it: markup, addresses, secrets, a token, control characters, length.
export const HOSTILE_MESSAGE = `<img src=x onerror=alert(1)> Too many requests\u0000 from 203.0.113.7 and 2001:db8::1, token=abc123 Bearer xyz7 see ` +
  `https://evil.example/a?b=c mail ops@example.com cookie: Rsi-Token=deadbeef ${"A".repeat(40)} &amp; "quoted" ${"w".repeat(300)}`;
export const UNSAFE_PARTS = ["<", ">", "&", "\"", "=", "203.0.113.7", "2001:db8", "abc123", "xyz7", "evil.example", "ops@example.com", "deadbeef", "A".repeat(24)];

function completed(at, seq) {
  return {
    kind: "request-completed", method: "GET", route: "/account/pledges", page: 1, pageCount: 1, responseStatus: 200, recordsReceived: 1,
    at, seq, extra: LONG, nested: { deep: LONG }
  };
}

export function hostileJob(job, at) {
  const log = [
    ...Array.from({ length: 76 }, (_, index) => completed(at, index + 1)),
    { kind: "unknown-kind", at, seq: 77, text: LONG },
    { kind: "section-started", section: LONG, at, seq: 78 },
    { kind: "request-started", method: "GET", route: `/${LONG}`, at, seq: 79 },
    { kind: "request-completed", method: "GET", route: "/x", responseStatus: 200, recordsReceived: -5, elapsedMs: 1.5, at, seq: 80 },
    { kind: "section-completed", section: "pledges", recordsTotal: Number.MAX_VALUE, requestsTotal: 2, at: LONG, seq: 81 }
  ];
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`section${index}`, index]));
  return {
    ...job,
    mode: LONG,
    activityLog: log,
    lastActivity: { ...completed(at, 82), secret: LONG },
    httpRequestsBySection: { pledges: 3, [LONG]: 1, buybacks: -2, hangarLog: 1.5, ...many },
    requestProgressBySection: {
      pledges: { completed: 2, total: 5, totalKnown: true, subphase: "uec", extra: LONG },
      buybacks: { completed: -1, total: "many", totalKnown: true, nested: { deep: LONG } },
      [LONG]: { completed: 1, total: 1, totalKnown: true }
    },
    requestCount: -3,
    httpRequestCount: Number.MAX_VALUE,
    nextEligibleAt: LONG,
    sectionIndex: 1.5
  };
}

export function hostileRuntime(record, jobId) {
  if (record.id === "statusSequence") return { ...record, revision: LONG };
  return { ...record, status: LONG, pendingProposalId: LONG, lastProposalAt: LONG, lastCompletedRunId: LONG, activeJobId: null, lastTerminalJobId: jobId, extra: LONG };
}

export function hostilePaceHistory(record) {
  const counts = { acceptedRequests: -1, refusedRequests: 1.5, retriedRequests: Number.MAX_VALUE, slowSteps: "many" };
  return { ...record, pacing: { controllerVersion: LONG, settingsFingerprint: LONG, maximumFactor: Number.POSITIVE_INFINITY, ...counts, extra: { deep: LONG } } };
}

// The fields each activity kind may show (§12.5).
const COMMON = ["at", "kind", "seq"];
const REQUEST = [...COMMON, "method", "route", "page", "pageCount"];
export const ACTIVITY_FIELDS = Object.freeze({
  "section-started": [...COMMON, "section"],
  "section-completed": [...COMMON, "section", "recordsTotal", "requestsTotal"],
  "section-set-aside": [...COMMON, "section", "code"],
  "rate-limited": [...COMMON, "section", "signal", "waitMs"],
  "free-retry": [...COMMON, "section", "signal", "waitMs"],
  "smart-check": [...COMMON, "section", "check", "outcome", "httpStatus"],
  "request-started": REQUEST,
  "request-completed": [...REQUEST, "responseStatus", "recordsReceived", "recordsTotal", "retryAfterMs", "elapsedMs"],
  "request-failed": [...REQUEST, "error", "elapsedMs"]
});

// Every string at most 500 characters, every number finite, every list and object at most 64 entries, and each
// activity with its kind's fields alone.
export function assertBoundedEverywhere(value, where = "status") {
  if (typeof value === "string") assert.ok(value.length <= 500, `${where} has ${value.length} characters`);
  else if (typeof value === "number") assert.ok(Number.isFinite(value), `${where} is not finite`);
  else if (Array.isArray(value)) {
    assert.ok(value.length <= 64, `${where} has ${value.length} entries`);
    for (const [index, entry] of value.entries()) assertBoundedEverywhere(entry, `${where}[${index}]`);
  } else if (value && typeof value === "object") {
    const keys = Object.keys(value);
    assert.ok(keys.length <= 64, `${where} has ${keys.length} fields`);
    if (where.includes("activityLog[") || where.endsWith("lastActivity")) {
      assert.ok(Object.hasOwn(ACTIVITY_FIELDS, value.kind), `${where} is of an unknown kind`);
      for (const key of keys) assert.ok(ACTIVITY_FIELDS[value.kind].includes(key), `${where}.${key} is not a field of ${value.kind}`);
    }
    for (const key of keys) {
      assert.ok(key.length <= 120, `${where} has a key of ${key.length} characters`);
      assertBoundedEverywhere(value[key], `${where}.${key}`);
    }
  }
}

// What an answer from RSI means for a run: accepted, a limit, a passing failure, unclear, a matter for the user, or a
// changed page or contract (PARSER_HARDENING.md §5). Pure: no chrome.*, no clock, no randomness. The collectors in
// rsi-api.js raise an RsiReadError carrying the signal; the runner reads the signal's kind.
(function initializeCitizenDataRsiAnswers(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataRsiAnswers = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataRsiAnswers() {
  "use strict";

  // The words limit answers commonly carry. No RSI limit code is on record; the first real one is added here.
  const LIMIT_PATTERN = /(rate.?limit|too.?many|throttl|slow.?down|try.?again|quota|exceeded|busy|captcha)/iu;
  const RSI_CODE = /^[A-Za-z0-9_-]{1,64}$/u;
  const SIGNAL_CODE = /^[A-Z0-9_]{1,80}$/u;
  const KINDS = Object.freeze(["limit", "transient", "ambiguous", "user", "contract"]);
  const REASONS = Object.freeze(["signed-out", "account-changed", "check-in-browser"]);
  const MESSAGE_LENGTH = 160;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // A string with control characters as spaces, runs of white space as one, trimmed and cut to `length`; or null.
  function bounded(value, length) {
    if (typeof value !== "string") return null;
    // Each character from U+0000 to U+001F and from U+007F to U+009F becomes a space.
    let text = "";
    for (const character of value) {
      const point = character.codePointAt(0);
      text += point <= 0x1f || point >= 0x7f && point <= 0x9f ? " " : character;
    }
    const result = [...text.replace(/\s+/gu, " ").trim()].slice(0, length).join("");
    return result.length > 0 ? result : null;
  }

  // RSI's own code, kept only in its known shape.
  function rsiCodeOf(value) {
    return typeof value === "string" && RSI_CODE.test(value) ? value : null;
  }

  function matchesLimit(...values) {
    return values.some((value) => typeof value === "string" && LIMIT_PATTERN.test(value));
  }

  // The wait RSI asks for, in milliseconds: whole seconds, or an HTTP date. Never negative, at most a day; null when
  // the value says neither.
  function parseRetryAfter(value, nowMs) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    let milliseconds;
    if (/^\d{1,9}$/u.test(text)) milliseconds = Number(text) * 1000;
    else {
      const date = Date.parse(text);
      if (!Number.isFinite(date) || !Number.isFinite(nowMs)) return null;
      milliseconds = date - nowMs;
    }
    return Math.min(DAY_MS, Math.max(0, milliseconds));
  }

  // The class of an HTTP status (§5.2 rows 1 to 6, 9 and 10). `fixedAddress` is true for the routes that cannot be gone.
  function classifyStatus({ status, fixedAddress = false } = {}) {
    if (!Number.isSafeInteger(status)) return "ambiguous";
    if (status >= 200 && status < 300) return "ok";
    if (status === 429 || status === 502 || status === 503 || status === 504) return "limit";
    if (status >= 500 && status < 600) return "transient";
    if (status === 401) return "user";
    if ((status === 403 || status === 404) && fixedAddress) return "ambiguous";
    if (status >= 400 && status < 500) return "contract";
    return "ambiguous";
  }

  // An RSI JSON answer whose `success` is not true or 1 (§5.2 rows 18 and 19).
  function classifyJsonRefusal(body) {
    const code = body?.code;
    const message = typeof body?.msg === "string" ? body.msg : typeof body?.message === "string" ? body.message : null;
    return Object.freeze({
      kind: matchesLimit(code, message) ? "limit" : "ambiguous",
      rsiCode: rsiCodeOf(code),
      rsiMessage: bounded(message, MESSAGE_LENGTH)
    });
  }

  // The errors of one GraphQL answer, bounded: a message of at most 160 characters and RSI's extension code when it
  // has the known shape. No other part of an error is kept.
  function boundedGraphqlErrors(errors) {
    return (Array.isArray(errors) ? errors : []).map((error) => Object.freeze({
      message: bounded(error?.message, MESSAGE_LENGTH),
      code: rsiCodeOf(error?.extensions?.code)
    }));
  }

  // Whether any error of a GraphQL answer carries a limit's words, in its message or its extension code.
  function classifyGraphqlErrors(errors) {
    const list = Array.isArray(errors) ? errors : [];
    return list.some((error) => matchesLimit(error?.message, error?.extensions?.code)) ? "limit" : list.length > 0 ? "ambiguous" : "ok";
  }

  function isArray(value) {
    return Array.isArray(value);
  }

  function isCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  // The data each GraphQL operation must hold for an answer with errors to be used (§5.7). `context.accountId` is the
  // authorized handle.
  const REQUIRED_DATA = Object.freeze({
    GetAuthenticatedUser: (data, context) => {
      const account = data?.account;
      return Boolean(account) && account.isAnonymous === false && typeof account.nickname === "string"
        && typeof context.accountId === "string" && account.nickname.toLowerCase() === context.accountId.toLowerCase() && isArray(account.badges);
    },
    GetAccountDashboardData: (data) => isArray(data?.accountDashboard?.account?.featuredBadges),
    GetReferralRecruitsList: (data) => {
      const list = data?.referralRecruitsList;
      return Boolean(list) && isArray(list.data) && isCount(list.recruitsCount) && isCount(list.prospectsCount);
    },
    getPrice: (data) => isCount(data?.price?.nativeAmount),
    ships: (data) => isArray(data?.ships)
  });

  // One GraphQL answer of an operation: `{ kind, errors, anomalyRows }`. Without errors it is "ok". With a limit's
  // words it is "limit", whatever data it holds. Otherwise it is "ok-with-anomalies" when the operation's required
  // data is there, with each error as an anomaly row, and "ambiguous" when it is not.
  function classifyGraphqlEnvelope(answer, operation) {
    const name = typeof operation === "string" ? operation : operation?.name;
    const context = typeof operation === "object" && operation !== null ? operation : {};
    const errors = isArray(answer?.errors) ? answer.errors : [];
    if (errors.length === 0) return Object.freeze({ kind: "ok", errors: Object.freeze([]), anomalyRows: Object.freeze([]) });
    const kept = Object.freeze(boundedGraphqlErrors(errors));
    if (classifyGraphqlErrors(errors) === "limit") return Object.freeze({ kind: "limit", errors: kept, anomalyRows: Object.freeze([]) });
    const required = Object.hasOwn(REQUIRED_DATA, name) ? REQUIRED_DATA[name] : null;
    if (!required?.(answer?.data, context)) return Object.freeze({ kind: "ambiguous", errors: kept, anomalyRows: Object.freeze([]) });
    const anomalyRows = kept.map((error) => Object.freeze({
      issueCode: "GRAPHQL_PARTIAL_ERROR",
      message: `RSI answered ${name} with an error beside usable data: ${error.message ?? "no message"}`.slice(0, MESSAGE_LENGTH),
      raw: Object.freeze({ operation: name, message: error.message, code: error.code })
    }));
    return Object.freeze({ kind: "ok-with-anomalies", errors: kept, anomalyRows: Object.freeze(anomalyRows) });
  }

  // A signal with every field present: unknown fields are dropped, and a field out of its shape becomes null.
  function makeSignal(fields) {
    const kind = KINDS.includes(fields?.kind) ? fields.kind : "ambiguous";
    const code = typeof fields?.code === "string" && SIGNAL_CODE.test(fields.code) ? fields.code : "RSI_READ_FAILED";
    const integerOrNull = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
    return {
      kind,
      code,
      httpStatus: Number.isSafeInteger(fields?.httpStatus) && fields.httpStatus >= 100 && fields.httpStatus <= 599 ? fields.httpStatus : null,
      rsiCode: rsiCodeOf(fields?.rsiCode),
      rsiMessage: bounded(fields?.rsiMessage, MESSAGE_LENGTH),
      retryAfterMs: integerOrNull(fields?.retryAfterMs),
      reason: kind === "user" && REASONS.includes(fields?.reason) ? fields.reason : null,
      method: fields?.method === "GET" || fields?.method === "POST" ? fields.method : null,
      route: typeof fields?.route === "string" && /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,200}$/u.test(fields.route) ? fields.route : null,
      page: Number.isSafeInteger(fields?.page) && fields.page > 0 ? fields.page : null,
      elapsedMs: integerOrNull(fields?.elapsedMs),
      fromCanary: fields?.fromCanary === true
    };
  }

  // The error a collector raises for an answer that has a class. Its message stays the code string the tests and the
  // panel use today, unless `options.message` keeps a text a user already sees (the signed-out cookie, §5.5).
  class RsiReadError extends Error {
    constructor(signal, options = undefined) {
      const value = makeSignal(signal);
      super(typeof options?.message === "string" ? options.message : value.code, options?.cause === undefined ? undefined : { cause: options.cause });
      this.name = "RsiReadError";
      this.signal = Object.freeze(value);
    }
  }

  return Object.freeze({
    KINDS,
    LIMIT_PATTERN,
    MESSAGE_LENGTH,
    REASONS,
    RsiReadError,
    bounded,
    classifyGraphqlEnvelope,
    classifyGraphqlErrors,
    classifyJsonRefusal,
    classifyStatus,
    makeSignal,
    parseRetryAfter,
    rsiCodeOf
  });
});

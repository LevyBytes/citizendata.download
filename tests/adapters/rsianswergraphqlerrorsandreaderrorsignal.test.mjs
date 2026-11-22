// The classes of RSI's GraphQL answers (PARSER_HARDENING.md §5.1, §5.2): errors beside each operation's required
// data, the limit words in them, and the complete, bounded signal an RsiReadError carries.
import assert from "node:assert/strict";
import test from "node:test";
import { Answers, plain } from "./rsianswerclassesundertest.mjs";

test("a GraphQL answer without errors is accepted, with a limit's words it is refused whatever data it holds", () => {
  assert.equal(Answers.classifyGraphqlEnvelope({ data: { ships: [] } }, "ships").kind, "ok");
  const limited = Answers.classifyGraphqlEnvelope({ data: { ships: [] }, errors: [{ message: "Too many requests" }] }, "ships");
  assert.equal(limited.kind, "limit");
  assert.deepEqual(plain(limited.anomalyRows), []);
  assert.equal(Answers.classifyGraphqlEnvelope({ errors: [{ message: "x", extensions: { code: "RATE_LIMITED" } }] }, "ships").kind, "limit");
  assert.equal(Answers.classifyGraphqlErrors([{ message: "Throttled" }]), "limit");
  assert.equal(Answers.classifyGraphqlErrors([{ message: "Unknown field" }]), "ambiguous");
  assert.equal(Answers.classifyGraphqlErrors([]), "ok");
});

test("a GraphQL error beside each operation's required data keeps the data with the error as an anomaly; without that data it is unclear", () => {
  const error = [{ message: "Field failed", extensions: { code: "INTERNAL", secret: { nested: true } } }];
  const cases = [
    ["GetAuthenticatedUser", { account: { isAnonymous: false, nickname: "SyntheticCitizen", badges: [] } }, { account: { isAnonymous: true, nickname: "SyntheticCitizen", badges: [] } }],
    ["GetAccountDashboardData", { accountDashboard: { account: { featuredBadges: [] } } }, { accountDashboard: { account: {} } }],
    ["GetReferralRecruitsList", { referralRecruitsList: { data: [], recruitsCount: 0, prospectsCount: 3 } }, { referralRecruitsList: { data: [], recruitsCount: -1, prospectsCount: 3 } }],
    ["getPrice", { price: { nativeAmount: 1500, amount: null } }, { price: { nativeAmount: 15.5 } }],
    ["ships", { ships: [{ id: 1 }] }, { ships: null }]
  ];
  for (const [name, usable, unusable] of cases) {
    const operation = { name, accountId: "SyntheticCitizen" };
    const kept = Answers.classifyGraphqlEnvelope({ data: usable, errors: error }, operation);
    assert.equal(kept.kind, "ok-with-anomalies", name);
    assert.deepEqual(plain(kept.errors), [{ message: "Field failed", code: "INTERNAL" }], `${name}: only the bounded message and code are kept`);
    assert.equal(kept.anomalyRows.length, 1);
    assert.equal(kept.anomalyRows[0].issueCode, "GRAPHQL_PARTIAL_ERROR");
    assert.deepEqual(plain(kept.anomalyRows[0].raw), { operation: name, message: "Field failed", code: "INTERNAL" });
    assert.equal(Answers.classifyGraphqlEnvelope({ data: unusable, errors: error }, operation).kind, "ambiguous", `${name} without its required data`);
    assert.equal(Answers.classifyGraphqlEnvelope({ errors: error }, operation).kind, "ambiguous", `${name} without data`);
  }
  // Another account's identity never makes an authenticated answer usable.
  assert.equal(Answers.classifyGraphqlEnvelope({ data: cases[0][1], errors: error }, { name: "GetAuthenticatedUser", accountId: "Someone" }).kind, "ambiguous");
  // An operation with no contract is never accepted with errors.
  assert.equal(Answers.classifyGraphqlEnvelope({ data: {}, errors: error }, "getRouteInfo").kind, "ambiguous");
});

test("an RsiReadError carries a complete, bounded signal, and its message is the code", () => {
  const error = new Answers.RsiReadError({ kind: "limit", code: "RSI_HTML_HTTP_429", httpStatus: 429, retryAfterMs: 30000, method: "GET", route: "/account/billing", page: 1, elapsedMs: 312, extra: "dropped" });
  assert.equal(error.name, "RsiReadError");
  assert.equal(error.message, "RSI_HTML_HTTP_429");
  assert.ok(Object.prototype.toString.call(error) === "[object Error]" && Object.isFrozen(error.signal));
  assert.deepEqual(plain(error.signal), {
    kind: "limit", code: "RSI_HTML_HTTP_429", httpStatus: 429, rsiCode: null, rsiMessage: null, retryAfterMs: 30000,
    reason: null, method: "GET", route: "/account/billing", page: 1, elapsedMs: 312, fromCanary: false
  });
  const user = new Answers.RsiReadError({ kind: "user", code: "RSI_SIGNED_OUT", reason: "signed-out" }, { cause: new TypeError("x") });
  assert.equal(user.signal.reason, "signed-out");
  assert.equal(user.cause.name, "TypeError");
  // A reason belongs to the user's kind only; an unknown kind or a malformed code is not passed on.
  assert.equal(new Answers.RsiReadError({ kind: "limit", code: "X", reason: "signed-out" }).signal.reason, null);
  assert.equal(new Answers.RsiReadError({ kind: "weird", code: "lower case" }).signal.kind, "ambiguous");
  assert.equal(new Answers.RsiReadError({ kind: "contract", code: "lower case" }).message, "RSI_READ_FAILED");
});

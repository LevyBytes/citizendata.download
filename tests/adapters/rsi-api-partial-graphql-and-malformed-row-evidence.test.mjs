// GraphQL answers with errors beside data, and malformed rows inside them (PARSER_HARDENING.md §5.7), for the profile
// and referral operations: each operation's contract decides whether the data is used. Usable data with errors is
// kept once, with each error as a bounded anomaly; an error with a limit's words refuses the step; missing required
// data is unclear.
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";
import { plain, ERROR, LIMIT, failure } from "./rsiapipartialgraphql.mjs";

function dossier() {
  return { kind: "html", body: "<main>profile</main>", finalUrl: "https://robertsspaceindustries.com/en/citizens/VerifiedCitizen" };
}

function authenticated(badges = [{ id: 10, title: "Legatus" }], extra = {}) {
  return [{ data: { account: { isAnonymous: false, nickname: "VerifiedCitizen", profileUrl: "/en/citizens/VerifiedCitizen", badges, badgeIcons: { favorite: null } } }, ...extra }];
}

function dashboard(account = { featuredBadges: [] }, routeInfo = { data: { platform: {} } }, extra = {}) {
  return [routeInfo, { data: { accountDashboard: { account } }, ...extra }];
}

const profileParsed = { profile: { raw: { handle: "VerifiedCitizen", displayName: "Verified Citizen", images: [], relatedUrls: [] } } };

const profileStep = (responses) => harness(responses, profileParsed).api.collectStep({ id: "profile" }, { accountId: "VerifiedCitizen", cursor: null, concurrentRequestStaggerMs: 0 });

test("GetAuthenticatedUser: errors beside the proven account keep the badges, each error as an anomaly", async () => {
  const result = await profileStep([dossier(), authenticated(undefined, { errors: [ERROR] }), dashboard()]);
  assert.equal(result.done, true);
  assert.deepEqual(plain(result.raw.unlockedBadges).map((badge) => badge.title), ["Legatus"]);
  const anomalies = plain(result.rawAnomalies);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].issueCode, "GRAPHQL_PARTIAL_ERROR");
  assert.deepEqual(anomalies[0].raw, { operation: "GetAuthenticatedUser", message: "Field badgeIcons failed", code: "INTERNAL" });
  assert.ok(!JSON.stringify(anomalies).includes("not kept"), "no extension object beyond the code is kept");
});

test("GetAuthenticatedUser: a limit's words refuse, and an answer without the proven account is unclear", async () => {
  const limited = await failure(profileStep([dossier(), authenticated(undefined, { errors: [LIMIT] }), dashboard()]));
  assert.deepEqual([limited.message, limited.signal.kind], ["RSI_GRAPHQL_REJECTED", "limit"]);
  const anonymous = [{ data: { account: { isAnonymous: true } }, errors: [ERROR] }];
  const unclear = await failure(profileStep([dossier(), anonymous, dashboard()]));
  assert.deepEqual([unclear.message, unclear.signal.kind], ["RSI_GRAPHQL_REJECTED", "ambiguous"]);
});

test("GetAccountDashboardData and getRouteInfo: route errors never discard the dashboard account; missing badges are unclear", async () => {
  const kept = await profileStep([dossier(), authenticated(), dashboard({ featuredBadges: [] }, { errors: [{ message: "route failed" }] })]);
  assert.equal(kept.done, true);
  assert.deepEqual(plain(kept.rawAnomalies).map((anomaly) => anomaly.raw.operation), ["getRouteInfo"]);
  const withErrors = await profileStep([dossier(), authenticated(), dashboard({ featuredBadges: [] }, undefined, { errors: [ERROR] })]);
  assert.deepEqual(plain(withErrors.rawAnomalies).map((anomaly) => anomaly.raw.operation), ["GetAccountDashboardData"]);
  const unclear = await failure(profileStep([dossier(), authenticated(), dashboard({}, undefined, { errors: [ERROR] })]));
  assert.equal(unclear.signal.kind, "ambiguous");
  const limited = await failure(profileStep([dossier(), authenticated(), dashboard({ featuredBadges: [] }, { errors: [LIMIT] })]));
  assert.equal(limited.signal.kind, "limit");
});

test("a malformed badge row is left out and kept as evidence; the other badges continue", async () => {
  const result = await profileStep([dossier(), authenticated([{ id: 10, title: "Legatus" }, { id: "eleven", title: "Bad" }, { id: 12, title: null }, { id: 13, title: "Last" }]), dashboard()]);
  assert.deepEqual(plain(result.raw.unlockedBadges).map((badge) => [badge.sourceIndex, badge.title]), [[0, "Legatus"], [3, "Last"]]);
  const anomalies = plain(result.rawAnomalies);
  assert.deepEqual(anomalies.map((anomaly) => [anomaly.issueCode, anomaly.recordIndex, anomaly.keySuffix]), [
    ["RSI_AUTHENTICATED_BADGE_ROW_CONTRACT_CHANGED", 2, "badge.1"],
    ["RSI_AUTHENTICATED_BADGE_ROW_CONTRACT_CHANGED", 3, "badge.2"]
  ]);
  assert.deepEqual(anomalies[0].raw, { id: "eleven", title: "Bad" });
});

test("GetReferralRecruitsList: a usable list with errors is kept with its anomalies; without totals it is unclear", async () => {
  const descriptor = { id: "referrals.legacy.recruits", parserOptions: { ladder: "legacy", kind: "recruits" } };
  const list = { data: [{ id: "a1", displayName: "One", nickname: "one", convertedOn: "2026-01-01" }], recruitsCount: 1, prospectsCount: 0 };
  const kept = await harness([[{ data: { referralRecruitsList: list }, errors: [ERROR] }]]).api.collectStep(descriptor, { cursor: null });
  assert.equal(kept.done, true);
  assert.equal(kept.raw.length, 1);
  assert.deepEqual(plain(kept.rawAnomalies).map((anomaly) => [anomaly.issueCode, anomaly.raw.operation]), [["GRAPHQL_PARTIAL_ERROR", "GetReferralRecruitsList"]]);
  const unclear = await failure(harness([[{ data: { referralRecruitsList: { data: [] } }, errors: [ERROR] }]]).api.collectStep(descriptor, { cursor: null }));
  assert.deepEqual([unclear.message, unclear.signal.kind], ["RSI_GRAPHQL_REJECTED", "ambiguous"]);
  // Without errors, a changed shape keeps its own contract code.
  const changed = await failure(harness([[{ data: { referralRecruitsList: { data: [] } } }]]).api.collectStep(descriptor, { cursor: null }));
  assert.deepEqual([changed.message, changed.signal.kind], ["RSI_REFERRAL_CONTRACT_CHANGED", "contract"]);
});

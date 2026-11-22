// Durable request slots in the profile step (PARSER_HARDENING.md §6.3, F19): the dossier and the signed-in user in
// the first slot, the dashboard badges at their own time.
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "../adapters/rsi-api-in-a-sandbox.mjs";
import { testClock } from "./durableslotsvirtualclock.mjs";
import { SECOND } from "./durableslotsbuybackrun.mjs";
import { slots } from "./durableslotsphasedsteps.mjs";

const PROFILE_ANSWERS = () => [
  { kind: "html", body: "<main>profile</main>", finalUrl: "https://robertsspaceindustries.com/en/citizens/VerifiedCitizen" },
  [{ data: { account: { isAnonymous: false, nickname: "VerifiedCitizen", profileUrl: "/en/citizens/VerifiedCitizen", badges: [], badgeIcons: { favorite: null, organization: null } } } }],
  [{ data: { platform: { route: { status: 200 } } } }, { data: { accountDashboard: { account: { featuredBadges: [] } } } }]
];

const PROFILE_PARSED = { profile: { raw: { handle: "VerifiedCitizen", displayName: "Verified Citizen", images: [], relatedUrls: ["https://robertsspaceindustries.com/en/citizens/VerifiedCitizen"] } } };

test("profile: the dossier and the signed-in user in the first slot, the dashboard badges at their own time", async () => {
  const clock = testClock(9_000_000);
  const starts = [];
  const fixture = harness(PROFILE_ANSWERS(), PROFILE_PARSED, { globals: clock.globals });
  const staggerMs = 30 * SECOND;
  const { result, phases } = await slots(fixture, clock, { id: "profile" }, { accountId: "VerifiedCitizen", cursor: null, concurrentRequestStaggerMs: staggerMs, onRequestActivity: async (activity) => { starts.push([activity.route, clock.now]); } });
  assert.equal(result.done, true);
  assert.deepEqual(phases, ["dashboard-badges"]);
  assert.deepEqual(starts, [["/en/citizens/VerifiedCitizen", 9_000_000], ["/graphql", 9_000_000], ["/graphql", 9_000_000 + staggerMs]]);
  const fetches = fixture.calls.filter((call) => call.kind === "fetch");
  assert.equal(fetches.length, 3, "each request was sent once");
  assert.equal(fixture.calls.filter((call) => call.kind === "cookie").length, fetches.filter((call) => call.options.method === "POST").length, "the token was read once for each request sent, none for a kept answer");
  // At factor 1 the gap is waited in memory, as today: no phase, the same three requests.
  const today = testClock(9_000_000);
  const inMemory = harness(PROFILE_ANSWERS(), PROFILE_PARSED, { globals: today.globals });
  const fast = await slots(inMemory, today, { id: "profile" }, { accountId: "VerifiedCitizen", cursor: null, concurrentRequestStaggerMs: 450 });
  assert.deepEqual([fast.result.done, fast.phases, today.now], [true, [], 9_000_450]);
});

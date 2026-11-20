import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

test("profile collection uses observed GraphQL badge contracts and retains supplied image provenance", async () => {
  const favoriteUrl = "https://media.robertsspaceindustries.com/legatus/heap_thumb.png";
  const { api, calls } = harness([
    { kind: "html", body: "<main>profile</main>", finalUrl: "https://robertsspaceindustries.com/en/citizens/VerifiedCitizen" },
    [{ data: { account: {
      isAnonymous: false,
      nickname: "VerifiedCitizen",
      profileUrl: "/en/citizens/VerifiedCitizen",
      badges: [
        { id: 10, title: "Legatus", __typename: "Badge" },
        { id: 10, title: "Legatus", __typename: "Badge" },
        { id: null, title: null, __typename: "Badge" }
      ],
      badgeIcons: { favorite: { icon: favoriteUrl, name: "Legatus" }, organization: null }
    } } }],
    [
      { data: { platform: { route: { status: 200 } } } },
      { data: { accountDashboard: { account: { featuredBadges: [
        { image: { src: favoriteUrl, alt: "Legatus", title: "Legatus" }, href: null },
        { image: { src: "/media/test/heap_note/org.png", alt: "TEST", title: "TEST" }, href: "/en/orgs/TEST" }
      ] } } } }
    ]
  ], {
    profile: {
      raw: {
        handle: "VerifiedCitizen",
        displayName: "Verified Citizen",
        images: [],
        relatedUrls: ["https://robertsspaceindustries.com/en/citizens/VerifiedCitizen"]
      }
    }
  });

  const result = await api.collectStep({ id: "profile" }, {
    accountId: "VerifiedCitizen",
    cursor: null,
    concurrentRequestStaggerMs: 1
  });
  assert.equal(result.done, true);
  assert.equal(result.raw.unlockedBadges.length, 3);
  assert.deepEqual([...result.raw.unlockedBadges].map((badge) => [badge.sourceIndex, badge.id, badge.title]), [
    [0, 10, "Legatus"],
    [1, 10, "Legatus"],
    [2, null, null]
  ]);
  assert.equal(result.raw.unlockedBadges[0].images[0].url, favoriteUrl);
  assert.equal(result.raw.selectedBadge.images[0].url, favoriteUrl);
  assert.equal(result.raw.featuredBadges[1].images[0].url, "https://robertsspaceindustries.com/media/test/heap_note/org.png");
  assert.deepEqual([...result.raw.featuredBadges[1].relatedUrls], ["https://robertsspaceindustries.com/en/orgs/TEST"]);
  assert.deepEqual([...result.sourceUrls], [
    "https://robertsspaceindustries.com/account/dashboard",
    "https://robertsspaceindustries.com/en/citizens/VerifiedCitizen",
    "https://robertsspaceindustries.com/graphql"
  ]);
  assert.deepEqual([...result.raw.relatedUrls].sort(), [...result.sourceUrls]);

  const fetches = calls.filter((call) => call.kind === "fetch");
  assert.deepEqual(fetches.map((call) => [call.options.method, new URL(call.url).pathname]), [
    ["GET", "/en/citizens/VerifiedCitizen"],
    ["POST", "/graphql"],
    ["POST", "/graphql"]
  ]);
  const authenticatedRequest = JSON.parse(fetches[1].options.body);
  assert.equal(Array.isArray(authenticatedRequest), true);
  assert.deepEqual(authenticatedRequest.map((request) => request.operationName), ["GetAuthenticatedUser"]);
  assert.match(authenticatedRequest[0].query, /badges\s*\{\s*id\s*title/gu);
  const dashboardRequest = JSON.parse(fetches[2].options.body);
  assert.deepEqual(dashboardRequest.map((request) => request.operationName), ["getRouteInfo", "GetAccountDashboardData"]);
  assert.equal(dashboardRequest[1].extensions.persistedQuery.sha256Hash, "91b68a1c3c6c80543fca1f9942a04109c5e3725c170b8f7b5911cabf97b495b0");
});

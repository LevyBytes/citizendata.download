import assert from "node:assert/strict";
import test from "node:test";
import { baseAccountDocument, observation, observedAt } from "../fixtures/account-document.mjs";
import { accountSchema, api } from "./account-document-contract-under-test.mjs";

test("schema accepts observed badge rows and supplied badge images", async () => {
  const document = baseAccountDocument();
  const badgeImage = {
    imageKey: "b".repeat(64),
    normalizationVersion: 1,
    role: "badge-favorite",
    url: "https://media.robertsspaceindustries.com/example/heap_thumb.png",
    altText: "Legatus",
    width: null,
    height: null,
    mimeTypeHint: null
  };
  document.profile.unlockedBadges = [
    { sourceIndex: 0, id: 1, title: "Legatus", images: [badgeImage] },
    { sourceIndex: 1, id: 1, title: "Legatus", images: [badgeImage] },
    { sourceIndex: 2, id: null, title: null, images: [] }
  ];
  document.profile.badgeCollection = { rawRows: 3, nonNullRows: 2, nullRows: 1, uniqueIdTitlePairs: 1, exactDuplicateRows: 1 };
  document.profile.selectedBadge = { title: "Legatus", images: [badgeImage] };
  document.profile.featuredBadges = [{ title: "Legatus", images: [badgeImage], relatedUrls: ["https://robertsspaceindustries.com/account/dashboard"] }];
  const stamped = await api.stampIntegrity(document);
  assert.equal(api.validateWithSchema(stamped, accountSchema).valid, true);

  const malformed = structuredClone(stamped);
  malformed.profile.unlockedBadges[0].sourceIndex = -1;
  assert.equal(api.validateWithSchema(malformed, accountSchema).valid, false);
});

test("schema and integrity retain exact anomalous source records without inventing normalized identity", async () => {
  const document = baseAccountDocument();
  document.referrals.legacy.prospects.push({
    recordKey: "legacy-redacted",
    displayName: null,
    handle: null,
    displayNameRaw: "",
    nicknameRaw: null,
    dateLabel: "enlistedOn",
    dateRaw: "2016-01-02T03:04:05Z",
    dateSortKey: "2016-01-02",
    images: [],
    observation: observation()
  });
  document.dataQuality = { anomalies: [{
    anomalyKey: "referrals.legacy.prospects:2805:29",
    section: "referrals.legacy.prospects",
    recordIndex: 2805,
    pageOrBatch: 29,
    issueCode: "RSI_REFERRAL_RECORD_DISPLAY_NAME_EMPTY_NICKNAME_NULL",
    message: "Legacy prospects page 29 row 5 contained unexpected RSI source values and was retained for review.",
    raw: { id: "legacy-redacted", displayName: "", nickname: null, enlistedOn: "2016-01-02T03:04:05Z" },
    retainedInNormalizedData: true,
    observedAt,
    sourceUrls: ["https://robertsspaceindustries.com/graphql"]
  }] };
  const stamped = await api.stampIntegrity(document);
  assert.equal(api.validateWithSchema(stamped, accountSchema).valid, true);
  assert.equal(await api.verifyIntegrity(stamped), true);
  assert.equal(stamped.referrals.legacy.prospects[0].displayNameRaw, "");
  assert.equal(stamped.dataQuality.anomalies[0].raw.displayName, "");
  assert.equal(stamped.dataQuality.anomalies[0].raw.nickname, null);
});

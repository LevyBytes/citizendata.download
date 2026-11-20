import assert from "node:assert/strict";
import test from "node:test";
import { Parsers, context } from "./pure-parsers-under-test.mjs";

test("referral and organization parsers keep source boundaries and redact unavailable identity", async () => {
  const referral = await Parsers.parseReferrals([{
    displayName: "Citizen",
    handle: "Citizen_1",
    dateLabel: "enlistedOn",
    dateRaw: "November 17, 2026",
    dateSortKey: "2026-11-17",
    images: [],
    relatedUrls: ["https://robertsspaceindustries.com/en/citizens/Citizen_1", "https://robertsspaceindustries.com/spectrum/messages/member/Citizen_1"]
  }], context, { ladder: "legacy", kind: "recruits" });
  assert.equal(referral.section, "referrals.legacy.recruits");
  assert.equal(referral.value[0].observation.relatedUrls.length, 2);

  const unavailable = await Parsers.parseReferrals([{
    recordKey: "legacy-redacted",
    displayName: null,
    handle: null,
    displayNameRaw: "",
    nicknameRaw: null,
    dateLabel: "enlistedOn",
    dateRaw: "2016-01-02T03:04:05Z",
    dateSortKey: "2016-01-02",
    images: [],
    relatedUrls: []
  }], context, { ladder: "legacy", kind: "prospects" });
  assert.equal(unavailable.value[0].recordKey, "legacy-redacted");
  assert.equal(unavailable.value[0].displayName, null);
  assert.equal(unavailable.value[0].handle, null);
  assert.equal(unavailable.value[0].displayNameRaw, "");
  assert.equal(unavailable.value[0].nicknameRaw, null);
  assert.equal(unavailable.value[0].observation.relatedUrls, undefined);

  const members = await Parsers.parseOrganizationMembers([
    { visibility: "restricted", displayName: "Must disappear", handle: "Secret", roles: ["Secret"] },
    {
      visibility: "public", displayName: "Citizen", handle: "Citizen_1", membershipType: "main", rank: "Recruit", rankStars: 0, roles: [], images: [],
      relatedUrls: ["https://robertsspaceindustries.com/en/orgs/TEST/members", "https://robertsspaceindustries.com/en/citizens/Citizen_1"]
    }
  ], context, { organizationSid: "TEST" });
  assert.equal(members.value[0].displayName, null);
  assert.equal(members.value[0].handle, null);
  assert.deepEqual(members.value[0].roles, []);
  assert.equal(members.value[1].organizationSid, "TEST");
  assert.equal(members.value[1].observation.relatedUrls.length, 2);
  await assert.rejects(
    () => Parsers.parseOrganizationMembers([], context, { organizationSid: "../TEST" }),
    /validated RSI SID/u
  );
});

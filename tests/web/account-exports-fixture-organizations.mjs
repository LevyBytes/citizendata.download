import { fixture } from "./account-exports-loaded-with-fixture-account.mjs";

export function organizationFixture() {
  const document = fixture();
  const member = (sid, key) => ({ recordKey: key, organizationSid: sid, displayName: key, handle: key, rank: "Recruit", rankStars: 0, roles: [], membershipType: "main", images: [] });
  document.organizations = {
    memberships: [
      { sid: "TEST", name: "TEST", membershipType: "main", memberCount: 24652, extra: { preserved: true } },
      { sid: "MMHC", name: "Million Mile High Club", membershipType: "affiliate", memberCount: 117 },
      { sid: "NOTPARSED", name: "Membership only", memberCount: 99 }
    ],
    members: [member("TEST", "test-first"), member("MMHC", "mmhc-first"), member("TEST", "test-last")]
  };
  document.sync.organizationMemberOutcomes = { TEST: { status: "complete" }, MMHC: { status: "partial" } };
  return document;
}

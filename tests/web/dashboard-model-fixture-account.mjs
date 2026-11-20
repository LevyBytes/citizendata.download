export function accountFixture() {
  return {
    schemaVersion: 1,
    account: { handle: "Example", ueeCitizenRecord: null },
    profile: { displayName: null, displayTitle: null, enlistedOnRaw: null, mainOrganizationSid: null, organizationRank: null, images: [] },
    financial: { balances: {}, billingTotal: null },
    pledges: [{ recordKey: "pledge-1", title: "Package", category: "gamePackage", createdDateRaw: null, items: [], images: [], sourceLinks: [] }],
    buybacks: [],
    referrals: { current: { prospects: [{ recordKey: "person-1", displayName: null, handle: null, dateRaw: "Date unavailable", dateSortKey: null }], recruits: [] }, legacy: { prospects: [], recruits: [] } },
    organizations: {
      memberships: [{ sid: "AFF", name: "Affiliate", membershipType: "affiliate", memberCount: 0, rank: null, images: [] }],
      members: [{ recordKey: "member-1", organizationSid: "AFF", visibility: "restricted", displayName: null, handle: null, membershipType: null, rank: null, rankStars: null, roles: [] }]
    },
    sync: { sectionOutcomes: {}, organizationMemberOutcomes: {} }
  };
}

export const observedAt = "2026-11-17T12:00:00Z";

export function observation() {
  return { firstObservedAt: observedAt, lastObservedAt: observedAt, parserVersion: "1.0.0" };
}

export function outcome(status = "complete") {
  return {
    status,
    parserVersion: "1.0.0",
    startedAt: observedAt,
    endedAt: observedAt,
    records: 0,
    pagesOrBatches: 1,
    warnings: []
  };
}

export function baseAccountDocument() {
  const sections = [
    "profile",
    "pledges",
    "hangarLog",
    "buybacks",
    "financial.balances",
    "referrals.current.prospects",
    "referrals.current.recruits",
    "referrals.legacy.prospects",
    "referrals.legacy.recruits",
    "organizations.memberships"
  ];
  return {
    schemaVersion: 1,
    generator: { name: "CitizenData", version: "0.1.0" },
    exportedAt: observedAt,
    account: {
      localAccountId: "00000000-0000-4000-8000-000000000001",
      ueeCitizenRecord: null,
      handle: null
    },
    profile: {
      displayName: null,
      handle: null,
      displayTitle: null,
      enlistedOnRaw: null,
      location: null,
      languages: [],
      website: null,
      biography: null,
      mainOrganizationSid: null,
      organizationRank: null,
      images: [],
      observation: observation()
    },
    pledges: [],
    hangarLog: [],
    buybacks: [],
    financial: {
      balances: { storeCredit: null, uec: null, rec: null },
      billingTotal: null,
      creditLedgers: { storeCredit: [], uec: [], rec: [] },
      subscriptions: [{
        subscriptionId: "subscription-1",
        plan: "Imperator",
        state: "active",
        startDateRaw: "November 1, 2026",
        endDateRaw: null,
        recurringState: "recurring",
        amount: { amount: "20.00", currency: "USD" },
        totalPaid: { amount: "440.00", currency: "USD" },
        totalTimeRaw: null,
        payments: [],
        images: [],
        observation: observation()
      }],
      orders: []
    },
    referrals: {
      current: { prospects: [], recruits: [] },
      legacy: { prospects: [], recruits: [] }
    },
    organizations: { memberships: [], members: [] },
    sync: {
      sectionOutcomes: Object.fromEntries(sections.map((section, index) => [section, outcome(index === 1 ? "partial" : "complete")])),
      organizationMemberOutcomes: {},
      checkpoints: {},
      runs: []
    },
    integrity: { algorithm: "SHA-256", contentHash: "0".repeat(64) }
  };
}
